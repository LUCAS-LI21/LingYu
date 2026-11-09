const UA={'User-Agent':'poi-intel-demo/0.1 (academic demo)','Referer':'https://xkz.nfra.gov.cn/jr/','X-Requested-With':'XMLHttpRequest'};
const fs=require('fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base='https://xkz.nfra.gov.cn/jr/PtBtBy/getLicence.do?useState=3&organNo=&fatherOrganNo=&organNoZhiju=&province=&orgAddress=&organType=&branchType=&fullName=&address='+encodeURIComponent('深圳')+'&flowNo=&jrOrganPreproty=';
(async()=>{
  const all=[];
  for(let start=0;start<2100;start+=10){
    const r=await fetch(base+'&start='+start+'&limit=10',{headers:UA});
    const j=await r.json();
    if(!j.datas||!j.datas.length){ console.log('空页 start',start); break }
    for(const d of j.datas) all.push({name:d.fullName,cert:d.certCode,setDate:d.setDate});
    if(start%200===0) console.log('进度',all.length,'/',j.total);
    if(all.length>=j.total) break;
    await sleep(1000);
  }
  fs.writeFileSync('data/nfra-sz-banks.json', JSON.stringify(all,null,1));
  const brands={};
  for(const b of all){ const m=b.name.match(/^(.{2,14}?银行)/); const k=m?m[1]:'其他'; brands[k]=(brands[k]||0)+1 }
  const top=Object.entries(brands).sort((a,b)=>b[1]-a[1]);
  console.log('完成 总数',all.length,'品牌数',top.length);
  console.log(JSON.stringify(top.slice(0,15)));
})().catch(e=>console.log('ERR',e.message))