// Browser-side metrics computation for a quarter's raw tickets.
// Produces the SAME metrics shape as precompute.js so the Q2-style renderer (archive.js)
// works identically for any (non-live) quarter. Weekly buckets are parameterized to the
// quarter's own date window (13 weeks from the quarter start).
(function () {
  const PHD_RESOLVERS = ['arunkzn','flofalgu','harisss','punithsd','mbozied','mellanej','nobregak','chousoud','dbiswamb','obalasut','shaavhad','tanviroo','urmahala'];
  const REGIONS = ['US','UK','CA','AU','BR','JP','IN','DE','SG','IT','FR','MX','AE','ES','NL','PL','TR','SA','EG'];

  function getRegion(t){for(const c of REGIONS){if((t||'').startsWith(c+' '))return c;}return'Other';}
  function getField(details,label){const m=(details||'').match(new RegExp(label+'\\s*:?\\s*([^\\n\\r]+)','i'));return m?m[1].trim():null;}
  function getIssue(details){return getField(details,'Issue');}
  function normDriver(dt){if(!dt)return null;const t=dt.trim().toUpperCase();if(t.includes('DSP')||t.includes('DA'))return'DSP DA';if(t.includes('FLEX')||t.includes('DP'))return'Flex DP';return'Flex DP';}
  function median(arr){if(!arr.length)return 0;const s=[...arr].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];}
  function avg(arr){return arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:0;}
  function isoWeekNum(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);const ys=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-ys)/864e5+1)/7);}

  // qStart/qEnd define the weekly window. 13 weekly buckets from qStart.
  function makeWeekTools(qStart, qEnd){
    function weekIndex(d){ if(d<qStart||d>qEnd)return -1; const days=Math.floor((new Date(d.getFullYear(),d.getMonth(),d.getDate())-qStart)/864e5); const idx=Math.floor(days/7); return idx>12?12:idx; }
    function weekLabels(){ const out=[]; for(let i=0;i<13;i++){ const dt=new Date(qStart.getFullYear(),qStart.getMonth(),qStart.getDate()+i*7); out.push('W'+String(isoWeekNum(dt)).padStart(2,'0')); } return out; }
    return { weekIndex, weekLabels };
  }

  // compute(tickets, {start, endExclusive}) -> metrics object matching precompute.js shape.
  function compute(data, range){
    const qStart = range && range.start ? new Date(range.start) : new Date(2026,3,1);
    const qEndEx = range && range.endExclusive ? new Date(range.endExclusive) : new Date(2026,6,1);
    const qEnd = new Date(qEndEx.getTime()-1);
    const { weekIndex, weekLabels } = makeWeekTools(qStart, qEnd);

    const T=data.length;
    const statuses={},closureCodes={},severities={},rootCauses={},assignees={},resolvers={},regions={},driverTypes={},resolutionTypes={},incidentTypes={},parties={};
    const resTimes=[],ages=[];
    const hiDist={'0':0,'1':0,'2':0,'3+':0};let hiTotal=0,hiRepeat=0;
    const uniqStations=new Set(),uniqAssignees=new Set(),uniqResolvers=new Set();
    let resolvedClosed=0,open=0,reopen=0;
    const createdByMonth={},resolvedByMonth={},createdByYear={},resolvedByYear={},createdByQuarter={},resolvedByQuarter={};
    const createdWeekQ=new Array(13).fill(0),resolvedWeekQ=new Array(13).fill(0);
    const slaResolvedWeek=new Array(13).fill(0),slaWithinWeek=new Array(13).fill(0);const slaHrsConst=240;
    const sevByYear={};const resTimeByMonth={};
    const rcXregion={},driverXincident={},regionXincident={};
    const incidentAgents={};

    data.forEach(r=>{
      statuses[r.Status]=(statuses[r.Status]||0)+1;
      if(r.ClosureCode)closureCodes[r.ClosureCode]=(closureCodes[r.ClosureCode]||0)+1;
      if(r.Severity)severities[r.Severity]=(severities[r.Severity]||0)+1;
      if(r.RootCause)rootCauses[r.RootCause]=(rootCauses[r.RootCause]||0)+1;
      if(r.AssigneeIdentity){assignees[r.AssigneeIdentity]=(assignees[r.AssigneeIdentity]||0)+1;uniqAssignees.add(r.AssigneeIdentity);}
      if(r.ResolvedByIdentity){const rb=r.ResolvedByIdentity.includes('AutoSIM')?'AutoSIM':r.ResolvedByIdentity;resolvers[rb]=(resolvers[rb]||0)+1;uniqResolvers.add(rb);}
      const region=getRegion(r.Title||'');regions[region]=(regions[region]||0)+1;
      const dt=normDriver(getField(r.RootCauseDetails,'Driver Type'));if(dt)driverTypes[dt]=(driverTypes[dt]||0)+1;
      const res=getField(r.RootCauseDetails,'Resolution');if(res)resolutionTypes[res]=(resolutionTypes[res]||0)+1;
      const iss=getIssue(r.RootCauseDetails);const incType=iss||'Unknown';if(iss)incidentTypes[iss]=(incidentTypes[iss]||0)+1;
      // incident-type drill-down (agents + their tickets)
      if(iss){
        let bucket=iss;const isPet=(iss==='Pet Incident'||iss==='Attack w/ Pet');
        if(isPet){const cc=(r.ClosureCode||'').trim();bucket=(cc==='Immediately Resolved'||cc==='Automatically Closed')?'Pet Incident (First time)':'Pet Incident';}
        const agent=r.ResolvedByIdentity?(r.ResolvedByIdentity.includes('AutoSIM')?'AutoSIM':r.ResolvedByIdentity):(r.AssigneeIdentity||'(unassigned)');
        incidentAgents[bucket]=incidentAgents[bucket]||{};incidentAgents[bucket][agent]=incidentAgents[bucket][agent]||[];
        incidentAgents[bucket][agent].push({id:r.ShortId||r.IssueId||'',url:r.IssueUrl||'',resolved:(r.ResolvedDate||'').split('T')[0]||''});
      }
      const t=r.Title||'';if(t.includes('Customer Incident'))parties.Customer=(parties.Customer||0)+1;else if(t.includes('Community Member'))parties['Community Member']=(parties['Community Member']||0)+1;else parties.Other=(parties.Other||0)+1;
      const st=getField(r.RootCauseDetails,'Station ID');if(st)uniqStations.add(st);
      const hiM=(r.RootCauseDetails||'').match(/Historical Incident:\s*(\d+)/i);if(hiM){const n=parseInt(hiM[1]);hiTotal++;if(n>0)hiRepeat++;if(n===0)hiDist['0']++;else if(n===1)hiDist['1']++;else if(n===2)hiDist['2']++;else hiDist['3+']++;}
      if(r.Status==='Resolved'||r.Status==='Closed')resolvedClosed++;else open++;
      if(r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-new Date(r.CreateDate))/36e5;if(h>=0)resTimes.push(h);}
      if(r.Age&&!isNaN(parseInt(r.Age)))ages.push(parseInt(r.Age));
      const cd=new Date(r.CreateDate);
      if(!isNaN(cd)){const y=cd.getFullYear();const mo=`${y}-${String(cd.getMonth()+1).padStart(2,'0')}`;const q=`${y}-Q${Math.floor(cd.getMonth()/3)+1}`;
        createdByYear[y]=(createdByYear[y]||0)+1;createdByMonth[mo]=(createdByMonth[mo]||0)+1;createdByQuarter[q]=(createdByQuarter[q]||0)+1;
        const cwi=weekIndex(cd);if(cwi>=0)createdWeekQ[cwi]++;
        if(!sevByYear[y])sevByYear[y]={};if(r.Severity)sevByYear[y][r.Severity]=(sevByYear[y][r.Severity]||0)+1;
        if(r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-cd)/36e5;if(h>=0){if(!resTimeByMonth[mo])resTimeByMonth[mo]=[];resTimeByMonth[mo].push(h);}}
      }
      const rd=new Date(r.ResolvedDate);
      if(!isNaN(rd)){const y=rd.getFullYear();const mo=`${y}-${String(rd.getMonth()+1).padStart(2,'0')}`;const q=`${y}-Q${Math.floor(rd.getMonth()/3)+1}`;
        resolvedByYear[y]=(resolvedByYear[y]||0)+1;resolvedByMonth[mo]=(resolvedByMonth[mo]||0)+1;resolvedByQuarter[q]=(resolvedByQuarter[q]||0)+1;
        const rwi=weekIndex(rd);if(rwi>=0){resolvedWeekQ[rwi]++;if(r.CreateDate){const h=(rd-new Date(r.CreateDate))/36e5;if(h>=0){slaResolvedWeek[rwi]++;if(h<=slaHrsConst)slaWithinWeek[rwi]++;}}}}
      const rcKey=(r.RootCause||'Unknown').replace(/^\s*-\s*/,'').substring(0,40);
      rcXregion[rcKey]=rcXregion[rcKey]||{};rcXregion[rcKey][region]=(rcXregion[rcKey][region]||0)+1;
      if(dt){driverXincident[dt]=driverXincident[dt]||{};driverXincident[dt][incType]=(driverXincident[dt][incType]||0)+1;}
      regionXincident[region]=regionXincident[region]||{};regionXincident[region][incType]=(regionXincident[region][incType]||0)+1;
    });
    resTimes.sort((a,b)=>a-b);ages.sort((a,b)=>a-b);
    const slaHrs=240;const slaCompliant=resTimes.filter(h=>h<=slaHrs).length;
    const resTrendLabels=Object.keys(resTimeByMonth).sort();
    const resTrendData=resTrendLabels.map(m=>+median(resTimeByMonth[m]).toFixed(1));
    const years=Object.keys(createdByYear).sort();
    const yoy=years.map((y,i)=>{if(i===0)return{year:y,count:createdByYear[y],growth:null};const prev=createdByYear[years[i-1]];return{year:y,count:createdByYear[y],growth:prev?(((createdByYear[y]-prev)/prev)*100).toFixed(1):null};});
    function sortObj(o){return Object.entries(o).sort((a,b)=>b[1]-a[1]);}
    const dates=data.map(r=>new Date(r.CreateDate)).filter(d=>!isNaN(d));
    return {
      total:T,resolvedClosed,open,resolutionRate:T?+(resolvedClosed/T*100).toFixed(1):0,
      avgRes:+avg(resTimes).toFixed(1),medianRes:+median(resTimes).toFixed(1),minRes:+(resTimes[0]||0).toFixed(1),maxRes:+(resTimes[resTimes.length-1]||0).toFixed(0),
      avgAge:+avg(ages).toFixed(0),medianAge:median(ages),
      uniqAssignees:uniqAssignees.size,uniqResolvers:uniqResolvers.size,uniqStations:uniqStations.size,
      slaPct:resTimes.length?+(slaCompliant/resTimes.length*100).toFixed(1):0,slaHrs,
      reopen,hiRepeatPct:hiTotal?+(hiRepeat/hiTotal*100).toFixed(1):0,hiTotal,hiRepeat,
      dateRange:dates.length?[new Date(Math.min(...dates)).toISOString().split('T')[0],new Date(Math.max(...dates)).toISOString().split('T')[0]]:['',''],
      statuses:sortObj(statuses),closureCodes:sortObj(closureCodes),severities:sortObj(severities),
      rootCauses:sortObj(rootCauses).slice(0,20),assignees:sortObj(assignees).slice(0,25),
      resolvers:sortObj(resolvers),regions:sortObj(regions),driverTypes:sortObj(driverTypes).slice(0,12),
      resolutionTypes:sortObj(resolutionTypes).slice(0,15),incidentTypes:sortObj(incidentTypes).slice(0,20),parties:sortObj(parties),
      hiDist,phdResolvers:PHD_RESOLVERS,
      createdByYear:Object.entries(createdByYear).sort(),resolvedByYear:Object.entries(resolvedByYear).sort(),
      createdByMonth:Object.entries(createdByMonth).sort(),resolvedByMonth:Object.entries(resolvedByMonth).sort(),
      createdByQuarter:Object.entries(createdByQuarter).sort(),resolvedByQuarter:Object.entries(resolvedByQuarter).sort(),
      createdByWeek:weekLabels().map((lbl,i)=>[lbl,createdWeekQ[i]]),resolvedByWeek:weekLabels().map((lbl,i)=>[lbl,resolvedWeekQ[i]]),
      slaByWeek:weekLabels().map((lbl,i)=>({week:lbl,resolved:slaResolvedWeek[i],within:slaWithinWeek[i],pct:slaResolvedWeek[i]?+(slaWithinWeek[i]/slaResolvedWeek[i]*100).toFixed(1):null})),
      sevByYear,resTrendLabels,resTrendData,yoy,
      rcXregion,driverXincident,regionXincident,
      incidentAgents
    };
  }

  window.QuarterMetrics = { compute };
})();
