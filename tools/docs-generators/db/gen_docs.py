import re, subprocess, json, html, collections
sch=open("schema.sql").read()
# table meta from comments
meta={}; order=[]
for m in re.finditer(r"^--- table (\w+) \| ([^|]+) \| (.+)$",sch,re.M):
    meta[m.group(1)]=(m.group(2).strip(),m.group(3).strip()); order.append(m.group(1))
# column comments
colc={}
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);",sch,re.S):
    t=m.group(1)
    for line in m.group(2).split("\n"):
        mm=re.match(r"\s+(\w+)\s+.*?--\s*(.+)$",line)
        if mm and mm.group(1).upper() not in ("PRIMARY","UNIQUE","CHECK","FOREIGN","EXCLUDE","CONSTRAINT"):
            colc[(t,mm.group(1))]=mm.group(2).strip()
def q(sql):
    r=subprocess.run(["psql","-h","/tmp","-p","5499","-U","postgres","-d","crm_test","-tA","-F","\t","-c",sql],capture_output=True,text=True,check=True)
    return [l.split("\t") for l in r.stdout.strip().split("\n") if l]
cols=q("""select c.table_name,c.column_name,c.ordinal_position,
 case when c.data_type='USER-DEFINED' then c.udt_name when c.data_type='ARRAY' then replace(c.udt_name,'_','')||'[]'
      when c.data_type='character' then 'char('||c.character_maximum_length||')'
      when c.data_type='numeric' then 'numeric('||c.numeric_precision||','||c.numeric_scale||')'
      when c.data_type like 'timestamp%with time zone' then 'timestamptz' when c.data_type like 'time without%' then 'time' else c.data_type end,
 c.is_nullable, coalesce(c.column_default,''), coalesce(c.generation_expression,''), c.is_generated
 from information_schema.columns c join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema
 where c.table_schema='public' and t.table_type='BASE TABLE' order by c.table_name,c.ordinal_position""")
fks=q("""select con.conname, cl.relname, rf.relname,
 (select string_agg(a.attname,',' order by k.n) from unnest(con.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum),
 (select string_agg(a.attname,',' order by k.n) from unnest(con.confkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.attnum),
 con.confdeltype
 from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_class rf on rf.oid=con.confrelid join pg_namespace n on n.oid=cl.relnamespace
 where con.contype='f' and n.nspname='public'""")
cons=q("""select cl.relname, con.contype, pg_get_constraintdef(con.oid) from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace
 where n.nspname='public' and con.contype in ('p','u','c','x') order by cl.relname, con.contype""")
idx=q("""select tablename, indexname, indexdef from pg_indexes where schemaname='public' and indexname not in (select conname from pg_constraint) order by tablename, indexname""")
T=collections.OrderedDict()
for t in order: T[t]={"cols":[],"fk":[],"pk":[],"uq":[],"ck":[],"ex":[],"ix":[]}
for t,c,_,ty,nul,de,gen,isg in cols:
    if t in T: T[t]["cols"].append(dict(name=c,type=ty,null=nul=="YES",default=de,gen=gen if isg=="ALWAYS" else ""))
for name,t,rt,cc,rc,dt in fks:
    if t in T: T[t]["fk"].append(dict(cols=cc.split(","),ref=rt,refcols=rc.split(","),ondel={"c":"cascade","r":"restrict","n":"set null","a":"","d":"set default"}[dt]))
for t,ct,d in cons:
    if t not in T: continue
    if ct=="p": T[t]["pk"]=re.findall(r"\((.*)\)",d)[0].split(", ")
    elif ct=="u": T[t]["uq"].append(d)
    elif ct=="c": T[t]["ck"].append(d)
    elif ct=="x": T[t]["ex"].append(d)
for t,n,d in idx:
    if t in T: T[t]["ix"].append((n,d))
# column FK map (ignore tenant_id part)
for t,v in T.items():
    fkmap={}
    for f in v["fk"]:
        cs=[c for c in f["cols"] if c!="tenant_id"] or f["cols"]
        if f["ref"]=="tenants" and cs==["tenant_id"]: fkmap["tenant_id"]="tenants"; continue
        for c in cs:
            if c=="tenant_id": continue
            fkmap[c]=f["ref"]
    v["fkmap"]=fkmap
json.dump({"meta":meta,"T":T},open("catalog.json","w"),default=str)
print(len(T),"tables;",sum(len(v["cols"]) for v in T.values()),"columns;",len(fks),"foreign keys;",sum(len(v["ck"]) for v in T.values()),"checks;",len(idx),"extra indexes")
