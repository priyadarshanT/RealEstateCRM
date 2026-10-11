import sys
from playwright.sync_api import sync_playwright
src,out,label,fmt=sys.argv[1],sys.argv[2],sys.argv[3],(sys.argv[4] if len(sys.argv)>4 else "A4")
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto("file://"+src); pg.wait_for_timeout(500)
    pg.emulate_media(media="print")
    pg.pdf(path=out,print_background=True,prefer_css_page_size=True,display_header_footer=True,header_template="<span></span>",
      footer_template=f'<div style="font-size:7px;color:#888;width:100%;text-align:center">{label} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',margin={"top":"10mm","bottom":"12mm","left":"10mm","right":"10mm"})
    b.close()
