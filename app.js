(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const config = window.SITE_CONFIG || {};
  const form = $('#calc-form');
  const money = n => 'NT$ ' + Math.round(n).toLocaleString('zh-TW');
  const moneyFields = ['assets','saving','spending'];
  const deepForm = $('#deep-form');
  const cashflowForm = $('#cashflow-form');
  const assetDefinitions = [
    {key:'stock',label:'股票／ETF'}, {key:'bond',label:'債券'},
    {key:'deposit',label:'定存'}, {key:'gold',label:'黃金'},
    {key:'property',label:'房產'}, {key:'other',label:'其他'}
  ];
  const cashflowAssetDefinitions = [
    {key:'stock_high',label:'高股息型股票／ETF'}, {key:'stock_market',label:'市值型股票／ETF'},
    ...assetDefinitions.slice(1)
  ];
  const parseMoney = value => Number(String(value).replace(/,/g,''));
  const formatMoneyInput = input => { const value=parseMoney(input.value); if(input.value.trim() && Number.isFinite(value)) input.value=Math.round(value).toLocaleString('en-US'); };
  const uid = () => 's-' + Math.random().toString(36).slice(2,10);
  const seed = [
    {id:'demo-1',nickname:'海邊散步',ageBand:'35–44 歲',retireBand:'55–64 歲',assetBand:'500–1,000 萬',spendBand:'3–5 萬',lifeBand:'90 歲',result:'穩步前進',demo:true},
    {id:'demo-2',nickname:'週五不加班',ageBand:'25–34 歲',retireBand:'50–54 歲',assetBand:'100–300 萬',spendBand:'3–5 萬',lifeBand:'90 歲',result:'持續累積',demo:true},
    {id:'demo-3',nickname:'小島計畫',ageBand:'45–54 歲',retireBand:'55–64 歲',assetBand:'1,000–2,000 萬',spendBand:'5–8 萬',lifeBand:'85 歲',result:'接近目標',demo:true}
  ];
  let latest = null;
  let toastTimer;
  const toast = msg => { const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3200); };
  const readShares = () => { try { return JSON.parse(localStorage.getItem('slowfire-shares')||'[]'); } catch { return []; } };
  const writeShares = rows => localStorage.setItem('slowfire-shares',JSON.stringify(rows));
  async function api(path, options={}) {
    if(!config.shareApiBaseUrl) throw new Error('local');
    const res=await fetch(config.shareApiBaseUrl.replace(/\/$/,'')+path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    if(!res.ok) throw new Error('API request failed'); return res.status===204?null:res.json();
  }
  const normalize = row => ({...row,createdAt:row.createdAt||new Date().toISOString()});
  async function getShares(){ if(config.shareApiBaseUrl){try{return (await api('/shares')).map(normalize)}catch(e){console.warn('分享 API 讀取失敗，改用本機資料',e)}} return readShares().map(normalize); }
  function calc(data) {
    const {age,retireAge,lifeAge,assets,saving,spending,returnRate,inflation}=data;
    if(retireAge<age) throw new Error('退休年齡不能早於目前年齡。');
    if(lifeAge<=retireAge) throw new Error('預期壽命需要晚於退休年齡。');
    const r=(1+returnRate/100)/(1+inflation/100)-1;
    let balance=assets; const points=[{age,value:balance}]; let retirementValue=balance;
    const monthlyRate=Math.pow(1+r,1/12)-1;
    for(let y=age+1;y<=lifeAge;y++) {
      if(y<=retireAge) { for(let m=0;m<12;m++) balance=balance*(1+monthlyRate)+saving; }
      else { for(let m=0;m<12;m++) balance=Math.max(0,balance*(1+monthlyRate)-spending); }
      if(y===retireAge) retirementValue=balance;
      points.push({age:y,value:balance});
    }
    // Match the projection's monthly withdrawals and effective monthly real return.
    let target=0; for(let m=0;m<(lifeAge-retireAge)*12;m++) target=(target+spending)/(1+monthlyRate);
    const affordable=retirementValue>=target;
    return {points,retirementValue,endValue:points.at(-1).value,target,affordable,realRate:r};
  }
  function calcDeep(data) {
    const {age,retireAge,lifeAge,saving,spending,inflation,assetRows}=data;
    if(retireAge<age) throw new Error('退休年齡不能早於目前年齡。');
    if(lifeAge<=retireAge) throw new Error('預期壽命需要晚於退休年齡。');
    if(saving<0||spending<=0||assetRows.some(row=>!Number.isFinite(row.amount)||row.amount<0||!Number.isFinite(row.returnRate))) throw new Error('請確認資產金額、報酬率、每月儲蓄與支出。');
    const startBalances=assetRows.map(row=>row.amount), startTotal=startBalances.reduce((a,b)=>a+b,0);
    if(startTotal===0&&saving===0) throw new Error('目前資產與每月儲蓄皆為 0，請至少填入其中一項。');
    const contributionWeights=startTotal>0?startBalances.map(v=>v/startTotal):assetRows.map(()=>1/assetRows.length);
    const monthlyRates=assetRows.map(row=>Math.pow((1+row.returnRate/100)/(1+inflation/100),1/12)-1);
    const simulate=(initialBalances,firstAge,monthlySaving)=>{
      const balances=initialBalances.slice(), weights=contributionWeights;
      let retirementValue=firstAge===retireAge?balances.reduce((a,b)=>a+b,0):null;
      let retirementBalances=firstAge===retireAge?balances.slice():null;
      let depletedAt=null; const points=[{age:firstAge,value:balances.reduce((a,b)=>a+b,0)}];
      for(let year=firstAge+1;year<=lifeAge;year++){
        for(let month=0;month<12;month++){
          for(let i=0;i<balances.length;i++) balances[i]=Math.max(0,balances[i]*(1+monthlyRates[i]));
          if(year<=retireAge){for(let i=0;i<balances.length;i++)balances[i]+=monthlySaving*weights[i];}
          else if(depletedAt===null){
            const total=balances.reduce((a,b)=>a+b,0);
            if(total<=spending){depletedAt=retireAge+((year-retireAge-1)*12+month+Math.max(0,total)/spending)/12;balances.fill(0);}
            else {const remaining=(total-spending)/total;for(let i=0;i<balances.length;i++)balances[i]*=remaining;}
          }
        }
        if(year===retireAge){retirementValue=balances.reduce((a,b)=>a+b,0);retirementBalances=balances.slice();}
        points.push({age:year,value:balances.reduce((a,b)=>a+b,0)});
      }
      return {points,retirementValue:retirementValue??startTotal,retirementBalances:retirementBalances??balances.slice(),endValue:balances.reduce((a,b)=>a+b,0),depletionAge:depletedAt};
    };
    const projected=simulate(startBalances,age,saving), retirementMix=projected.retirementBalances;
    const retirementTotal=retirementMix.reduce((a,b)=>a+b,0);
    const targetWeights=retirementTotal>0?retirementMix.map(v=>v/retirementTotal):assetRows.map(()=>1/assetRows.length);
    const survives=amount=>{const at=simulate(targetWeights.map(w=>amount*w),retireAge,0).depletionAge;return at===null||at>=lifeAge;};
    let low=0,high=Math.max(projected.retirementValue,spending*12,1),guard=0;
    while(!survives(high)&&high<1e18&&guard++<60)high*=2;
    if(guard>=60||!Number.isFinite(high)) throw new Error('目前假設下無法求出退休目標，請檢查各項報酬率。');
    for(let i=0;i<52;i++){const mid=(low+high)/2;if(survives(mid))high=mid;else low=mid;}
    const totalReturn=assetRows.reduce((sum,row,i)=>sum+contributionWeights[i]*row.returnRate,0);
    return {...projected,target:high,affordable:projected.depletionAge===null||projected.depletionAge>=lifeAge,realRate:null,weightedReturn:totalReturn};
  }
  function drawChart(points,retireAge) {
    const svg=$('#chart'), W=800,H=280,p={l:72,r:20,t:22,b:22}, iw=W-p.l-p.r,ih=H-p.t-p.b;
    const max=Math.max(...points.map(x=>x.value),1), min=Math.min(0,...points.map(x=>x.value));
    const x=i=>p.l+i*iw/(points.length-1), y=v=>p.t+ih-(v-min)/(max-min||1)*ih;
    const vals=[0,.25,.5,.75,1], grid=vals.map(q=>{const v=min+(max-min)*q, yy=y(v);return `<line class="grid-line" x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}"/><text class="grid-label" x="${p.l-12}" y="${yy+4}" text-anchor="end">${v===0?'0':Math.round(v/10000)+'萬'}</text>`}).join('');
    const d=points.map((pt,i)=>`${i?'L':'M'}${x(i)},${y(pt.value)}`).join(' '), area=`${d} L${x(points.length-1)},${y(0)} L${x(0)},${y(0)} Z`;
    const ri=Math.max(0,points.findIndex(pt=>pt.age===retireAge)); const rx=x(ri);
    svg.innerHTML=`<defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#a8b49a" stop-opacity=".42"/><stop offset="100%" stop-color="#a8b49a" stop-opacity=".02"/></linearGradient></defs>${grid}<path class="area" d="${area}"/><line class="retire-line" x1="${rx}" x2="${rx}" y1="${p.t}" y2="${H-p.b}"/><path class="trend" d="${d}"/><circle class="chart-dot" cx="${rx}" cy="${y(points[ri].value)}" r="5"/><text class="retire-label" x="${rx+8}" y="${p.t+12}">退休 ${retireAge} 歲</text>`;
    $('#axis-start').textContent=`${points[0].age} 歲`;
    $('#axis-end').textContent=`${points.at(-1).age} 歲`;
  }
  function updateResult(data,result) {
    latest={data,result}; $('#results').classList.remove('hidden');
    $('#verdict').textContent=result.affordable?'依目前假設，退休目標有機會達成':'以目前假設，退休資產可能不足';
    const gap=Math.abs(result.retirementValue-result.target);
    $('#verdict-detail').textContent=data.mode==='deep'
      ? result.affordable?`依照各類資產假設，資產預估可支應至 ${data.lifeAge} 歲；退休時資產高於目標約 ${money(gap)}。`:`依照此試算方式，資產約在 ${result.depletionAge.toFixed(1)} 歲時用盡，退休時與目標差距約 ${money(gap)}。`
      : result.affordable?`預估退休時資產高於目標約 ${money(gap)}，持續留意假設變化。`:`退休時預估資產與目標差距約 ${money(gap)}，可試著延後退休、增加儲蓄或調整支出。`;
    $('#result-banner').classList.toggle('caution',!result.affordable);
    $('#retire-total').textContent=money(result.retirementValue); $('#fire-number').textContent=money(result.target);
    $('#retire-age-out').textContent=`${data.retireAge} 歲`; $('#retire-years').textContent=`約 ${data.retireAge-data.age} 年後`;
    $('#end-total').textContent=money(result.endValue); drawChart(result.points,data.retireAge);
    $('#chart-caption').textContent=data.mode==='deep'?'每類資產按個別報酬率逐月推估；退休支出按當月資產比例提領。':'此為依固定年化報酬率逐年推估的簡化走勢，實際市場報酬不會固定。';
  }
  const ageInput=form.elements.age,retireInput=form.elements.retireAge;
  ageInput.addEventListener('input',()=>{retireInput.min=ageInput.value||'18';});
  for(const name of moneyFields){const input=form.elements[name];input.addEventListener('focus',()=>{input.value=input.value.replace(/,/g,'');});input.addEventListener('input',()=>{input.value=input.value.replace(/[^0-9]/g,'');});input.addEventListener('blur',()=>formatMoneyInput(input));formatMoneyInput(input);}
  form.addEventListener('submit',e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(form)); for(const k of ['age','retireAge','lifeAge','returnRate','inflation'])data[k]=Number(data[k]); for(const k of moneyFields)data[k]=parseMoney(data[k]); if(!Number.isFinite(data.assets)||data.assets<0||!Number.isFinite(data.saving)||data.saving<0||!Number.isFinite(data.spending)||data.spending<=0)throw new Error('請確認資產、每月儲蓄與支出金額。'); updateResult(data,calc(data));$('#results').scrollIntoView({behavior:'smooth',block:'start'});}catch(err){toast(err.message)}});
  for(const input of deepForm.querySelectorAll('[data-money="true"]')){input.addEventListener('focus',()=>{input.value=input.value.replace(/,/g,'');});input.addEventListener('input',()=>{input.value=input.value.replace(/[^0-9]/g,'');});input.addEventListener('blur',()=>formatMoneyInput(input));formatMoneyInput(input);}
  deepForm.elements.age.addEventListener('input',()=>{deepForm.elements.retireAge.min=deepForm.elements.age.value||'18';});
  $('#sync-deep').addEventListener('click',()=>{
    for(const key of ['age','retireAge','lifeAge','saving','spending','inflation'])deepForm.elements[key].value=form.elements[key].value;
    deepForm.elements.asset_stock.value=String(parseMoney(form.elements.assets.value));
    deepForm.elements.rate_stock.value=form.elements.returnRate.value;
    for(const item of assetDefinitions.slice(1)){deepForm.elements['asset_'+item.key].value='0';deepForm.elements['rate_'+item.key].value='0';}
    for(const input of deepForm.querySelectorAll('[data-money="true"]'))formatMoneyInput(input);
    toast('已帶入基本試算數字；資產先放入股票／ETF，可再分配到其他類別。');
  });
  deepForm.addEventListener('submit',e=>{e.preventDefault();try{
    const data=Object.fromEntries(new FormData(deepForm));
    for(const key of ['age','retireAge','lifeAge','saving','spending','inflation'])data[key]=['saving','spending'].includes(key)?parseMoney(data[key]):Number(data[key]);
    data.assetRows=assetDefinitions.map(item=>({key:item.key,label:item.label,amount:parseMoney(data['asset_'+item.key]),returnRate:Number(data['rate_'+item.key])}));
    data.assets=data.assetRows.reduce((sum,row)=>sum+row.amount,0);data.returnRate=data.assetRows.reduce((sum,row)=>sum+row.amount*row.returnRate,0)/(data.assets||1);data.mode='deep';
    if(!Number.isFinite(data.assets)||data.assets<0||!Number.isFinite(data.saving)||data.saving<0||!Number.isFinite(data.spending)||data.spending<=0)throw new Error('請確認資產、每月儲蓄與支出金額。');
    updateResult(data,calcDeep(data));$('#results').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){toast(err.message)}});
  for(const input of cashflowForm.querySelectorAll('[data-money="true"]')){input.addEventListener('focus',()=>{input.value=input.value.replace(/,/g,'');});input.addEventListener('input',()=>{input.value=input.value.replace(/[^0-9]/g,'');});input.addEventListener('blur',()=>formatMoneyInput(input));formatMoneyInput(input);}
  $('#sync-cashflow').addEventListener('click',()=>{
    for(const item of cashflowAssetDefinitions){const sourceKey=item.key==='stock_market'?'stock':item.key==='stock_high'?'__zero':item.key;const value=sourceKey==='__zero'?0:parseMoney(deepForm.elements['asset_'+sourceKey].value);cashflowForm.elements['cf_amount_'+item.key].value=Number.isFinite(value)?String(value):'0';}
    for(const input of cashflowForm.querySelectorAll('[data-money="true"]'))formatMoneyInput(input);
    toast('已帶入深度試算資產；股票／ETF 金額先放入市值型，現金流率請自行填寫。');
  });
  cashflowForm.addEventListener('submit',e=>{e.preventDefault();try{
    const rows=cashflowAssetDefinitions.map(item=>({label:item.label,amount:parseMoney(cashflowForm.elements['cf_amount_'+item.key].value),yieldRate:Number(cashflowForm.elements['cf_yield_'+item.key].value)}));
    const otherIncome=[['薪資／工作收入','income_salary'],['年金／補助','income_pension'],['其他收入','income_other']].map(([label,name])=>({label,amount:parseMoney(cashflowForm.elements[name].value)}));
    const expenses=[['食','expense_food'],['衣','expense_clothing'],['住','expense_housing'],['行','expense_transport'],['教育','expense_education'],['保險','expense_insurance'],['育樂','expense_leisure'],['雜支','expense_misc']].map(([label,name])=>({label,amount:parseMoney(cashflowForm.elements[name].value)}));
    if(rows.some(row=>!Number.isFinite(row.amount)||row.amount<0||!Number.isFinite(row.yieldRate)||row.yieldRate<0)||otherIncome.some(row=>!Number.isFinite(row.amount)||row.amount<0)||expenses.some(row=>!Number.isFinite(row.amount)||row.amount<0))throw new Error('請確認收入、支出金額與資產現金流率皆為有效的非負數字。');
    const assetIncome=rows.map(row=>({...row,monthly:row.amount*row.yieldRate/1200})).filter(row=>row.monthly>0);
    const monthlyIncome=assetIncome.reduce((sum,row)=>sum+row.monthly,0)+otherIncome.reduce((sum,row)=>sum+row.amount,0);
    const monthlyExpenses=expenses.reduce((sum,row)=>sum+row.amount,0),net=monthlyIncome-monthlyExpenses;
    const incomeRows=[...assetIncome.map(row=>({label:`${row.label}（資產現金流）`,amount:row.monthly})),...otherIncome];
    $('#cashflow-income-total').textContent=money(monthlyIncome);$('#cashflow-expense-total').textContent=money(monthlyExpenses);$('#cashflow-net-total').textContent=`${net<0?'−':'+'}${money(Math.abs(net))}`;
    $('#cashflow-net-note').textContent=net>0?'收入高於支出':'收入－支出';$('#cashflow-net-card').classList.toggle('is-negative',net<0);$('#cashflow-net-card').classList.toggle('is-positive',net>=0);
    $('#cashflow-income-breakdown').innerHTML=[...incomeRows,{label:'每月總收入',amount:monthlyIncome,total:true}].map(row=>`<tr class="${row.total?'cashflow-total-row':''}"><th scope="row">${escapeHtml(row.label)}</th><td>${money(row.amount)}</td></tr>`).join('');
    $('#cashflow-expense-breakdown').innerHTML=[...expenses,{label:'每月總支出',amount:monthlyExpenses,total:true}].map(row=>`<tr class="${row.total?'cashflow-total-row':''}"><th scope="row">${escapeHtml(row.label)}</th><td>${money(row.amount)}</td></tr>`).join('');
    $('#cashflow-results').classList.remove('hidden');$('#cashflow-results').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(err){toast(err.message)}});
  $('#edit-button').addEventListener('click',()=>$('#calculator').scrollIntoView({behavior:'smooth'}));
  const shareDialog=$('#share-dialog');
  $('#open-share').addEventListener('click',()=>{if(!latest){toast('請先完成退休試算。');return}const d=latest.data;const sf=$('#share-form');const set=(n,v)=>sf.elements[n].value=v;set('ageBand',d.age<35?'25–34 歲':d.age<45?'35–44 歲':d.age<55?'45–54 歲':d.age<65?'55–64 歲':'65 歲以上');set('retireBand',d.retireAge<50?'50 歲以下':d.retireAge<55?'50–54 歲':d.retireAge<65?'55–64 歲':'65 歲以上');set('assetBand',d.assets<1000000?'未滿 100 萬':d.assets<3000000?'100–300 萬':d.assets<5000000?'300–500 萬':d.assets<10000000?'500–1,000 萬':d.assets<20000000?'1,000–2,000 萬':'2,000 萬以上');set('spendBand',d.spending<30000?'未滿 3 萬':d.spending<50000?'3–5 萬':d.spending<80000?'5–8 萬':d.spending<120000?'8–12 萬':'12 萬以上');set('lifeBand',d.lifeAge<=80?'80 歲':d.lifeAge<=85?'85 歲':d.lifeAge<=90?'90 歲':'95 歲以上');shareDialog.showModal()});
  $('#share-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(d.get('website'))return;const code=uid();const row={id:uid(),nickname:String(d.get('nickname')).trim().slice(0,16),ageBand:d.get('ageBand'),retireBand:d.get('retireBand'),assetBand:d.get('assetBand'),spendBand:d.get('spendBand'),lifeBand:d.get('lifeBand'),result:latest.result.affordable?'目標有機會達成':'仍在累積中',createdAt:new Date().toISOString(),ownerHash:code,reported:false};if(!row.nickname){toast('請填寫暱稱。');return}try{if(config.shareApiBaseUrl){await api('/shares',{method:'POST',body:JSON.stringify(row)})}else{const rows=readShares();if(rows.length>=10){toast('此裝置最多保留 10 筆自行分享，請先刪除舊分享。');return}writeShares([row,...rows])}sessionStorage.setItem('slowfire-owner-'+row.id,code);shareDialog.close();f.reset();await renderCommunity();toast(`分享完成。刪除代碼：${code}（已暫存於此分頁）`)}catch(err){toast('分享暫時無法儲存，請稍後再試。')}});
  const reportDialog=$('#report-dialog');
  async function removeCase(id){const row=readShares().find(x=>x.id===id);let code=sessionStorage.getItem('slowfire-owner-'+id);if(!code){code=prompt('請輸入這筆分享的刪除代碼：');if(!code)return}if(row?.ownerHash!==code){toast('刪除代碼不正確，無法移除此分享。');return}if(!confirm('確定刪除這筆分享？'))return;try{if(config.shareApiBaseUrl)await api('/shares/'+encodeURIComponent(id),{method:'DELETE',headers:{'X-Delete-Code':code}});else writeShares(readShares().filter(x=>x.id!==id));sessionStorage.removeItem('slowfire-owner-'+id);await renderCommunity();toast('分享已刪除。')}catch{toast('刪除暫時無法完成。')}}
  async function reportCase(id,reason){try{if(config.shareApiBaseUrl)await api('/reports',{method:'POST',body:JSON.stringify({shareId:id,reason})});else{const reports=JSON.parse(localStorage.getItem('slowfire-reports')||'[]');if(reports.includes(id)){toast('這筆案例已在此裝置檢舉過。');return}reports.push(id);localStorage.setItem('slowfire-reports',JSON.stringify(reports))}await renderCommunity();toast('感謝回報，已標記給管理者查看。')}catch{toast('檢舉暫時無法送出。')}}
  function card(row,own,reported){return `<article class="community-card ${reported?'reported':''}"><div class="community-card-top"><div class="avatar">${escapeHtml(row.nickname.slice(0,1))}</div><div class="person"><strong>${escapeHtml(row.nickname)}</strong><span>${escapeHtml(row.ageBand)} · 預計 ${escapeHtml(row.retireBand)} 退休</span></div><span class="case-result">${escapeHtml(row.result)}</span></div><div class="case-stats"><div><span>目前資產</span><strong>${escapeHtml(row.assetBand)}</strong></div><div><span>每月支出</span><strong>${escapeHtml(row.spendBand)}</strong></div><div><span>預期壽命</span><strong>${escapeHtml(row.lifeBand)}</strong></div></div><div class="case-actions">${row.demo?'<span class="demo-label">示範案例</span>':own?'<span class="own-label">我的分享</span>':''}<div>${own?`<button data-action="delete" data-id="${escapeHtml(row.id)}">刪除分享</button>`:''}<button data-action="report" data-id="${escapeHtml(row.id)}">${reported?'已檢舉':'檢舉'}</button></div></div></article>`}
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  async function renderCommunity(){const user=await getShares(),reports=JSON.parse(localStorage.getItem('slowfire-reports')||'[]'),rows=[...user.map(r=>({...r,demo:false})),...seed];$('#case-count').textContent=String(rows.length).padStart(2,'0');$('#community-list').innerHTML=rows.map(r=>card(r,!!sessionStorage.getItem('slowfire-owner-'+r.id),reports.includes(r.id))).join('');}
  $('#community-list').addEventListener('click',async e=>{const b=e.target.closest('button[data-action]');if(!b)return;const id=b.dataset.id;if(b.dataset.action==='delete'){await removeCase(id);return}const r=readShares().find(x=>x.id===id);if(r?.ownerHash===sessionStorage.getItem('slowfire-owner-'+id)){toast('你可以使用「刪除分享」移除自己的案例。');return}$('#report-form').elements.caseId.value=id;reportDialog.showModal()});
  $('#report-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const d=new FormData(f);await reportCase(d.get('caseId'),d.get('reason'));reportDialog.close()});
  const feedback=$('#feedback-link');if(config.feedbackFormUrl){feedback.href=config.feedbackFormUrl;feedback.target='_blank';feedback.rel='noreferrer'}else{feedback.addEventListener('click',e=>{e.preventDefault();toast('回饋表單網址尚待設定，請在 config.js 填入 Google 表單網址。')})}
  document.addEventListener('click',e=>{if(e.target.matches('dialog'))e.target.close()});
  renderCommunity();
})();
