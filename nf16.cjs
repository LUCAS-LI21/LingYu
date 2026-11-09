const UA={'User-Agent':'poi-intel-demo/0.1 (academic demo)','Referer':'https://xkz.nfra.gov.cn/jr/','X-Requested-With':'XMLHttpRequest'};
const B='https://xkz.nfra.gov.cn/jr/PtBtBy/getLicence.do?useState=3&organNo=&fatherOrganNo=&organNoZhiju=&province=&orgAddress=&organType=&branchType=&fullName=&address=';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  for(const [kw,start] of [['深圳',300],['深圳',280],['福田',0],['福田',100]]){
    const r=await fetch(B+encodeURIComponent(kw)+'&flowNo=&jrOrganPreproty=&start='+start+'&limit=10',{headers:UA});
    const j=await r.json();
    console.log('kw='+kw,'start='+start,'-> total',j.total,'返回',(j.datas||[]).length);
    await sleep(1200);
  }
})()