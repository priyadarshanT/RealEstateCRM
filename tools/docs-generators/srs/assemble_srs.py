import re,subprocess
subprocess.run(["pandoc","-f","gfm","-t","html","--wrap=none","../docs/01-SRS.md","-o","srs_body.html"],check=True)
subprocess.run(["python3","build.py"],check=True)
head=open("shell_head.html").read(); body=open("body_final.html").read()
web=head+body+"\n</div>\n"
open("crm-srs.html","w").write(web)
PRINT=open("print_style.txt").read(); FLOW=open("print_flow.txt").read()
p=web.replace('</style>\n<div class="doc">','</style>\n'+PRINT+'<div class="doc">',1)
p=re.sub(r'<pre class="mermaid">.*?</pre>',lambda m:FLOW,p,count=1,flags=re.S)
open("crm-srs-print.html","w").write(p)
print("assembled")
