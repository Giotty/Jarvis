import sys,json,os,base64,contextlib
import pymupdf
request=json.load(sys.stdin)
try:
    file=request['path']
    if os.path.getsize(file)>50*1024*1024: raise ValueError('Document exceeds the 50 MB limit')
    start=max(0,int(request.get('page',0)));limit=max(1,min(10,int(request.get('pages',3))))
    with pymupdf.open(file) as document:
        if document.needs_pass: raise ValueError('Unlock this document first')
        pages=[]
        for number in range(start,min(document.page_count,start+limit)):
            page=document[number];text=page.get_text(sort=True)[:12000]
            tables=[]
            if request.get('tables',True):
                try:
                    with contextlib.redirect_stdout(sys.stderr):
                        for table in page.find_tables().tables[:5]:
                            tables.append([[str(cell or '')[:300] for cell in row[:30]] for row in table.extract()[:30]])
                except Exception: pass
            record={'page':number+1,'text':text,'tables':tables,'scanned':not bool(text.strip())}
            if request.get('rendered') and len(pages)<3:
                scale=min(1024/page.rect.width,1024/page.rect.height)
                png=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),alpha=False).tobytes('png')
                if len(png)<350000: record['image']='data:image/png;base64,'+base64.b64encode(png).decode('ascii')
            pages.append(record)
        print(json.dumps({'success':True,'verified':True,'backend':'local-pymupdf','pageCount':document.page_count,'pages':pages,'nextPage':start+limit if start+limit<document.page_count else None,'message':'Scanned pages need on-demand OCR or visual analysis.' if any(p['scanned'] for p in pages) else 'Extracted local document text and detected tables.'}))
except Exception as error:
    print(json.dumps({'success':False,'verified':False,'error':str(error)}))
