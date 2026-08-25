(() => {
'use strict';
const BUILTIN = window.WORD_BANK;
const KEY = {progress:'pte_fibl_progress_v2', settings:'pte_fibl_settings_v2', bank:'pte_fibl_bank_v2'};
const $ = id => document.getElementById(id);
const state = {
  bank: load(KEY.bank, BUILTIN), progress: load(KEY.progress, {}),
  settings: Object.assign({rate:.88,autoplay:true,retry:true,requeue:true,voice:'',accent:'auto',natural:true}, load(KEY.settings,{})),
  theme:'all', status:'all', queue:[], index:0, correct:0, wrong:0, current:null,
  attempt:0, firstCorrect:false, selectedGrade:null, autoGrade:null, sessionActive:false, hintUsed:false, slowUsed:false, playCount:0, requeued:new Set(), view:'practice',
  gradeBaseStreak:0, gradeSaved:false, requeueHandled:false, sessionGrades:{A:0,B:0,C:0}, practiceSource:'theme'
};
function load(k,f){try{const v=JSON.parse(localStorage.getItem(k));return v??f}catch{return f}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function p(id){
  const x=state.progress[id];
  if(!x)return {grade:'',attempts:0,correct:0,wrong:0,starred:false,starredAt:0,autoStarred:false,manualStarred:false,wrongStarred:false,lastSeen:0,lastWrong:0,nextReview:0,streak:0};
  if(x.manualStarred===undefined)x.manualStarred=!!x.starred&&!x.autoStarred;
  if(x.wrongStarred===undefined)x.wrongStarred=!!x.starred&&!!x.autoStarred;
  x.starred=!!(x.manualStarred||x.wrongStarred);
  return x;
}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('show'),2200)}
function normalize(s){return s.trim().toLowerCase().replace(/[’']/g,"'").replace(/\s+/g,' ')}
function themes(){const m=new Map();state.bank.forEach(x=>m.set(x.theme,(m.get(x.theme)||0)+1));return [...m.entries()]}
function due(item){const x=p(item.id);return Boolean(x.nextReview&&x.nextReview<=Date.now())}
function statusMatch(item){const x=p(item.id);if(state.status==='new')return !x.attempts;if(state.status==='review')return due(item);if(state.status==='starred')return x.starred;return true}
function filtered(){return state.bank.filter(x=>(state.theme==='all'||x.theme===state.theme)&&statusMatch(x))}
function smartScore(item){
  const x=p(item.id), isDue=due(item);
  // 智能顺序严格遵守：到期复习 > 未学新词 > 尚未到期的弱词 > 已掌握。
  // 这样不会因为 B/C 较弱就每天过度重复，破坏间隔效应。
  if(isDue){
    const dueWeight=x.grade==='C'?300:x.grade==='B'?200:100;
    return 10000+dueWeight+Math.min(90,Math.floor((Date.now()-x.nextReview)/86400000)*10);
  }
  if(!x.attempts)return 8000;
  if(x.grade==='C')return 4200;
  if(x.grade==='B')return 3200;
  if(x.grade==='A')return 1200-Math.min(500,(x.streak||0)*80);
  return 2000;
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function buildQueue(){let a=filtered().slice();const order=$('orderSelect').value;if(order==='random')shuffle(a);else if(order==='original')a.sort((a,b)=>a.id-b.id);else a.sort((a,b)=>smartScore(b)-smartScore(a)||Math.random()-.5);const lim=$('limitSelect').value;if(lim!=='all')a=a.slice(0,+lim);return a}
function renderThemes(){const list=$('themeList');const allCount=state.bank.filter(statusMatch).length;list.innerHTML='';const themeEntries=themes().map(([name])=>[name,name,state.bank.filter(x=>x.theme===name&&statusMatch(x)).length]).filter(x=>state.status!=='starred'||x[2]>0);const entries=[['all','全部主题',allCount],...themeEntries];entries.forEach(([id,name,count])=>{const b=document.createElement('button');b.className='theme-item'+(state.theme===id?' active':'');b.innerHTML=`<span class="theme-name">${esc(name)}</span><span class="theme-count">${count}</span>`;b.onclick=()=>{state.theme=id;renderThemes();$('sessionTheme').textContent=name;$('topicChip').textContent=name;closeSidebar();if(state.status==='starred')showFavoriteLibrary();else startSession();};list.appendChild(b)});$('bankCount').textContent=state.bank.length+' 词'}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function setView(view){
  state.view=view;
  const favorites=view==='favorites';
  $('favoritesLibrary').classList.toggle('hidden',!favorites);
  $('studyCard').classList.toggle('hidden',favorites);
  $('sessionBar').classList.toggle('hidden',favorites);
  $('progressWrap').classList.toggle('hidden',favorites);
  if(favorites)$('emptyState').classList.add('hidden');
}
function favoriteItems(){return state.bank.filter(x=>p(x.id).starred&&(state.theme==='all'||x.theme===state.theme))}
function favoriteScopeMatch(item){
  const x=p(item.id),scope=$('favoriteScope')?.value||'all';
  if(scope==='wrong')return !!x.wrongStarred;
  if(scope==='manual')return !!x.manualStarred;
  if(scope==='C')return x.grade==='C';
  if(scope==='due')return due(item);
  return true;
}
function visibleFavoriteItems(applySort=true){const q=normalize($('favoriteSearch')?.value||'');let items=favoriteItems().filter(favoriteScopeMatch).filter(x=>!q||normalize([x.word,x.meaning,x.theme,x.subtheme,x.chunk,x.chunkZh].join(' ')).includes(q));if(!applySort)return items;const sort=$('favoriteSort')?.value||'recent';if(sort==='wrong')items.sort((a,b)=>(p(b.id).wrong||0)-(p(a.id).wrong||0)||(p(b.id).lastWrong||0)-(p(a.id).lastWrong||0));else if(sort==='theme')items.sort((a,b)=>a.theme.localeCompare(b.theme,'zh-CN')||a.subtheme.localeCompare(b.subtheme,'zh-CN')||a.id-b.id);else if(sort==='original')items.sort((a,b)=>a.id-b.id);else items.sort((a,b)=>Math.max(p(b.id).lastWrong||0,p(b.id).starredAt||0)-Math.max(p(a.id).lastWrong||0,p(a.id).starredAt||0)||b.id-a.id);return items}
function renderFavoriteLibrary(){
  const items=visibleFavoriteItems(true),total=favoriteItems().length,q=normalize($('favoriteSearch').value||''),scope=$('favoriteScope').value;
  const scopeText={all:'全部收藏',wrong:'听写错题',manual:'手动收藏',C:'C 类重点',due:'今天待复习'}[scope]||'全部收藏';
  $('favoritesSummary').textContent=`${total} 个收藏词 · 当前 ${items.length} 个（${scopeText}${state.theme==='all'?'':` · ${state.theme}`}）${q?' · 已搜索':''}`;
  const lim=$('favoritePracticeLimit')?.value||'20';
  const n=lim==='all'?items.length:Math.min(items.length,+lim);
  $('practiceFavoritesBtn').disabled=items.length===0;
  $('practiceFavoritesBtn').textContent=items.length?`▶ 练当前 ${n} 词`:'▶ 暂无可练词';
  const list=$('favoriteList');
  list.innerHTML=items.map(item=>{
    const x=p(item.id),sources=[];
    if(x.wrongStarred)sources.push('听写错题');
    if(x.manualStarred)sources.push('手动收藏');
    const source=sources.join(' + ')||'收藏';
    const when=x.lastWrong?` · 最近错 ${new Date(x.lastWrong).toLocaleDateString('zh-CN')}`:'';
    const dueText=due(item)?'<span class="favorite-badge due">到期</span>':'';
    return `<article class="favorite-row" data-id="${item.id}"><div class="favorite-word"><strong>${esc(item.word)}</strong><small>#${item.id} · ${esc(source)}${when}</small></div><div class="favorite-meaning">${esc(item.meaning||'—')}</div><div class="favorite-meta">${esc(item.theme)} · ${esc(item.subtheme||'')}<div class="favorite-badges"><span class="favorite-badge bad">错 ${x.wrong||0}</span><span class="favorite-badge">${x.grade||'未评级'}</span>${dueText}</div></div><div class="favorite-row-actions"><button class="mini-btn favorite-play" data-id="${item.id}" type="button">▶ 听 Chunk</button><button class="mini-btn favorite-remove" data-id="${item.id}" type="button">取消收藏</button></div></article>`
  }).join('');
  $('favoriteEmpty').classList.toggle('hidden',items.length>0);
  list.querySelectorAll('.favorite-play').forEach(b=>b.onclick=()=>{const item=state.bank.find(x=>x.id===+b.dataset.id);if(item)speak(null,item.chunk)});
  list.querySelectorAll('.favorite-remove').forEach(b=>b.onclick=()=>{
    const id=+b.dataset.id,x=p(id);
    x.starred=false;x.autoStarred=false;x.manualStarred=false;x.wrongStarred=false;
    state.progress[id]=x;save(KEY.progress,state.progress);renderThemes();renderFavoriteLibrary();toast('已取消收藏');
  });
}
function showFavoriteLibrary(){
  persistPendingGrade();
  if('speechSynthesis' in window)speechSynthesis.cancel();
  setView('favorites');
  $('sessionTheme').textContent=state.theme==='all'?'收藏':state.theme;
  renderFavoriteLibrary();
}
function autoStarCurrent(){
  if(!state.current)return;
  const x=p(state.current.id),wasStarred=x.starred;
  x.wrongStarred=true;x.autoStarred=true;x.starred=true;
  if(!x.starredAt)x.starredAt=Date.now();
  if(state.attempt===1){x.wrong=(x.wrong||0)+1;x.lastWrong=Date.now();}
  state.progress[state.current.id]=x;save(KEY.progress,state.progress);
  $('starBtn').textContent='★';
  if(!wasStarred)toast('答错，已自动收藏到错词列表');
  renderThemes();
}
function favoriteSmartScore(item){
  const x=p(item.id);
  if(due(item))return 10000+(x.grade==='C'?300:x.grade==='B'?200:100)+(x.wrong||0)*5;
  if(x.grade==='C')return 8000+(x.wrong||0)*10;
  if(x.grade==='B')return 7000+(x.wrong||0)*8;
  if(!x.attempts)return 6000;
  if(x.grade==='A')return 3000+(x.wrong||0)*5-Math.min(1000,(x.streak||0)*100);
  return 4000+(x.wrong||0)*5;
}
function startFavoritePractice(){
  persistPendingGrade();
  state.status='starred';state.practiceSource='favorites';setView('practice');$('sessionBar').classList.add('favorite-mode');$('backFavoritesPracticeBtn').classList.remove('hidden');$('startBtn').textContent='重新抽取收藏词';
  let a=visibleFavoriteItems(true).slice();
  const order=$('favoritePracticeOrder')?.value||'smart';
  if(order==='random')shuffle(a);
  else if(order==='smart')a.sort((a,b)=>favoriteSmartScore(b)-favoriteSmartScore(a)||a.id-b.id);
  // current = 严格保留收藏列表当前排序，便于按主题/错误次数顺序系统复习。
  const lim=$('favoritePracticeLimit')?.value||'20';
  if(lim!=='all')a=a.slice(0,+lim);
  state.queue=a;state.index=0;state.correct=0;state.wrong=0;state.sessionGrades={A:0,B:0,C:0};state.sessionActive=true;state.requeued=new Set();
  if(!state.queue.length){$('studyCard').classList.add('hidden');$('emptyState').classList.remove('hidden');updateProgress();return}
  $('studyCard').classList.remove('hidden');$('emptyState').classList.add('hidden');
  $('sessionTheme').textContent=state.theme==='all'?'收藏词':`收藏 · ${state.theme}`;
  $('sessionTitle').textContent='收藏错词听写';showQuestion();
}
function targetRegex(word){const escaped=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(^|[^A-Za-z0-9])(${escaped})(?=$|[^A-Za-z0-9])`,'ig')}
function renderTarget(chunk,word,renderer){const rx=targetRegex(word);let out='',last=0,found=false,m;while((m=rx.exec(chunk))){const st=m.index+m[1].length,en=st+m[2].length;out+=esc(chunk.slice(last,st))+renderer(m[2]);last=en;found=true}out+=esc(chunk.slice(last));return {found,html:out}}
function maskChunk(chunk,word){const r=renderTarget(chunk,word,()=>'<span class="blank-slot" aria-label="答案空格">________</span>');return r.found?r.html:`${esc(chunk)} <span class="blank-slot">________</span>`}
function reviewDays(x,g){
  if(g==='C')return 0;
  if(g==='B')return 1;
  // 连续 A：3 → 7 → 14 → 30 天。首个 A 必须从 3 天开始，不能跳过第一档。
  const streak=Math.max(1,x.streak||1);
  return [3,7,14,30][Math.min(streak-1,3)];
}
function startSession(){
  persistPendingGrade();
  state.practiceSource='theme';setView('practice');$('sessionBar').classList.remove('favorite-mode');$('backFavoritesPracticeBtn').classList.add('hidden');$('startBtn').textContent='开始新一组';$('sessionTitle').textContent='Chunk 听写训练';
  if('speechSynthesis' in window)speechSynthesis.cancel();
  state.queue=buildQueue();state.index=0;state.correct=0;state.wrong=0;state.sessionGrades={A:0,B:0,C:0};state.sessionActive=true;state.requeued=new Set();
  if(!state.queue.length){$('studyCard').classList.add('hidden');$('emptyState').classList.remove('hidden');updateProgress();return}
  $('studyCard').classList.remove('hidden');$('emptyState').classList.add('hidden');showQuestion();
}
function showQuestion(){
  state.current=state.queue[state.index];state.attempt=0;state.firstCorrect=false;state.selectedGrade=null;state.autoGrade=null;state.hintUsed=false;state.slowUsed=false;state.playCount=0;state.gradeSaved=false;state.requeueHandled=false;state.gradeBaseStreak=p(state.current.id).streak||0;
  $('feedback').classList.add('hidden');$('answerForm').classList.remove('hidden');$('answerInput').disabled=false;$('submitBtn').disabled=false;$('answerInput').value='';$('answerInput').classList.remove('wrong');$('hintBox').classList.add('hidden');
  $('topicChip').textContent=state.current.theme+' · '+state.current.subtheme;$('starBtn').textContent=p(state.current.id).starred?'★':'☆';$('questionNo').textContent=`${state.index+1} / ${state.queue.length}`;
  $('listenPrompt').textContent='看英文 Chunk，听音补全空格';$('maskedChunk').innerHTML=maskChunk(state.current.chunk,state.current.word);$('listenHint').textContent='先看语境，再听完整 Chunk；只输入空格中的答案词';
  updateProgress();setTimeout(()=>{$('answerInput').focus();if(state.settings.autoplay)speak()},180);
}
function voiceScore(v){
  const name=(v.name||'').toLowerCase(),lang=(v.lang||'').toLowerCase();
  let score=0;
  if(/^en/.test(lang))score+=30;
  const accent=state.settings.accent||'auto';
  if(accent==='us'&&/en[-_]us/.test(lang))score+=30;
  if(accent==='gb'&&/en[-_]gb/.test(lang))score+=30;
  if(accent==='au'&&/en[-_]au/.test(lang))score+=30;
  if(accent==='auto'&&/en[-_](us|gb|au)/.test(lang))score+=15;
  if(/natural|neural|premium|enhanced|online/.test(name))score+=60;
  if(/samantha|ava|serena|daniel|karen|moira|tessa|zira|aria|jenny|guy|sonia|ryan/.test(name))score+=35;
  if(v.localService===false)score+=8;
  if(/compact|espeak|festival|robot/.test(name))score-=45;
  return score;
}
function getVoice(){
  if(!('speechSynthesis' in window))return null;
  const voices=window.speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang));
  const chosen=voices.find(v=>v.name===state.settings.voice);
  if(chosen)return chosen;
  return voices.sort((a,b)=>voiceScore(b)-voiceScore(a))[0];
}
function speechText(text){
  return String(text).replace(/\s+/g,' ').replace(/([,;:])\s*/g,'$1 ').replace(/([.!?])\s*/g,'$1 ').trim();
}
function speak(rate,text){
  if(!state.current && !text){startSession();return;}
  const content=text||(state.current&&state.current.chunk);if(!content)return;if(!text&&state.current)state.playCount++;
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window)){toast('当前浏览器不支持网页语音，请使用 Safari、Chrome 或 Edge');return;}
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(speechText(content));
  const v=getVoice();if(v){u.voice=v;u.lang=v.lang}else u.lang=state.settings.accent==='gb'?'en-GB':state.settings.accent==='au'?'en-AU':'en-US';
  u.rate=rate||state.settings.rate;u.pitch=1;u.volume=1;
  u.onstart=()=>{$('playBtn').classList.add('speaking');$('playBtn').querySelector('span').textContent='■'};
  u.onend=u.onerror=()=>{$('playBtn').classList.remove('speaking');$('playBtn').querySelector('span').textContent='▶'};
  setTimeout(()=>window.speechSynthesis.speak(u),40);
}
function submit(e){
  e.preventDefault();if(!state.current||$('answerInput').disabled)return;
  const val=normalize($('answerInput').value);if(!val){toast('请先输入答案词');return}
  state.attempt++;const ok=val===normalize(state.current.word);
  if(ok){state.firstCorrect=state.attempt===1;if(state.firstCorrect)state.correct++;finishAnswer(true);return}
  if(state.attempt===1)state.wrong++;
  autoStarCurrent();$('answerInput').classList.add('wrong');setTimeout(()=>$('answerInput').classList.remove('wrong'),300);
  if(state.settings.retry&&state.attempt===1){
    $('listenHint').textContent='还不正确。保持正常语速再听一次；需要时再手动使用 0.8×。';
    $('answerInput').select();speak();
  }else finishAnswer(false);
}
function finishAnswer(ok){
  $('answerInput').disabled=true;$('submitBtn').disabled=true;$('feedback').classList.remove('hidden');
  $('resultIcon').textContent=ok?'✓':'×';$('resultIcon').style.color=ok?'var(--ok)':'var(--bad)';$('resultTitle').textContent=ok?'拼写正确':'本题需要复习';$('attemptLabel').textContent=state.attempt===1?'首次作答':`第 ${state.attempt} 次作答`;
  $('answerWord').textContent=state.current.word;$('answerMeaning').textContent=state.current.meaning;$('chunkText').innerHTML=highlight(state.current.chunk,state.current.word);$('chunkZh').textContent=state.current.chunkZh;
  let auto='C',reason='最终仍未正确 → C';
  if(ok&&state.attempt===1&&state.playCount===1&&!state.hintUsed&&!state.slowUsed){auto='A';reason='首次作答 + 只听 1 遍 + 无提示/慢速 → A';}
  else if(ok){auto='B';
    if(state.attempt>1)reason='第二次才拼对 → B';
    else if(state.playCount===0)reason='未播放音频，仅凭语境答对 → B';
    else if(state.playCount>1)reason='重复播放后答对 → B';
    else if(state.slowUsed)reason='使用慢速后答对 → B';
    else if(state.hintUsed)reason='使用中文提示后答对 → B';
    else reason='需要辅助后答对 → B';
  }
  state.autoGrade=auto;selectGrade(auto,false);$('gradeReason').textContent=reason;updateRawProgress(ok);persistPendingGrade();
  $('feedback').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function highlight(chunk,word){return renderTarget(chunk,word,t=>`<mark class="answer-highlight">${esc(t)}</mark>`).html}
function updateRawProgress(ok){const x=p(state.current.id);x.attempts=(x.attempts||0)+1;x.lastSeen=Date.now();if(ok)x.correct=(x.correct||0)+1;state.progress[state.current.id]=x;save(KEY.progress,state.progress)}
function selectGrade(g,manual=false){
  const rank={C:1,B:2,A:3};
  if(manual&&state.autoGrade&&rank[g]>rank[state.autoGrade]){toast(`本题最高自动等级为 ${state.autoGrade}；可以手动降级，但不能升级`);return}
  state.selectedGrade=g;document.querySelectorAll('[data-grade]').forEach(b=>b.classList.toggle('selected',b.dataset.grade===g));
  if(manual&&!$('feedback').classList.contains('hidden')){persistPendingGrade(true);$('gradeReason').textContent=`已手动调整为 ${g}（只允许向下调整）`;}
}
function persistPendingGrade(force=false){
  if(!state.current||!state.selectedGrade||($('feedback')&&$('feedback').classList.contains('hidden')))return;
  if(state.gradeSaved&&!force)return;
  const x=p(state.current.id),g=state.selectedGrade;
  x.grade=g;x.streak=g==='A'?state.gradeBaseStreak+1:0;
  const days=reviewDays(x,g);x.nextReview=days===0?Date.now():Date.now()+days*86400000;
  state.progress[state.current.id]=x;save(KEY.progress,state.progress);state.gradeSaved=true;
}
function maybeRequeueCurrent(){
  if(state.requeueHandled||!state.current)return;
  state.requeueHandled=true;
  const g=state.selectedGrade||state.autoGrade;
  if(g!=='C'||!state.settings.requeue||state.requeued.has(state.current.id))return;
  // 必须保证至少隔 4 道别题再出现；若本组剩余不足 4 道，留到“待复习”而不是立即重现。
  const remaining=state.queue.length-state.index-1;
  if(remaining<4)return;
  state.requeued.add(state.current.id);state.queue.splice(state.index+5,0,state.current);
}
function next(){
  if(!$('feedback').classList.contains('hidden')){
    persistPendingGrade();maybeRequeueCurrent();
    const g=state.selectedGrade||state.autoGrade;if(g)state.sessionGrades[g]=(state.sessionGrades[g]||0)+1;
  }
  if(state.index>=state.queue.length-1){
    updateProgress(true);$('listenPrompt').textContent='本组训练完成';$('maskedChunk').textContent='本组题目已经完成';
    $('listenHint').textContent=`首次正确 ${state.correct} · 错题 ${state.wrong} · A ${state.sessionGrades.A} / B ${state.sessionGrades.B} / C ${state.sessionGrades.C}`;
    $('answerForm').classList.add('hidden');$('feedback').classList.add('hidden');$('questionNo').textContent=`${state.queue.length} / ${state.queue.length}`;toast('本组训练完成');renderThemes();return;
  }
  state.index++;showQuestion();renderThemes();
}
function updateProgress(done=false){const total=state.queue.length,cur=done?total:(total?state.index:0);$('progressText').textContent=total?`${cur} / ${total}`:'准备开始';$('scoreText').textContent=`首次正确 ${state.correct} · 错题 ${state.wrong}`;$('progressBar').style.width=total?`${cur/total*100}%`:'0%'}
function toggleStar(){
  if(!state.current)return;const x=p(state.current.id);
  if(x.starred){x.starred=false;x.autoStarred=false;x.manualStarred=false;x.wrongStarred=false;toast('已取消收藏');}
  else{x.starred=true;x.manualStarred=true;x.starredAt=Date.now();toast('已手动收藏');}
  state.progress[state.current.id]=x;save(KEY.progress,state.progress);$('starBtn').textContent=x.starred?'★':'☆';renderThemes();
}
function voiceLabel(v){const natural=voiceScore(v)>=75?'★ 自然':'普通';return `${natural} · ${v.name} · ${v.lang}`}
function fillVoices(){
  const sel=$('voiceSelect');
  if(!('speechSynthesis' in window)){sel.innerHTML='<option>当前浏览器不支持网页语音</option>';$('voiceRecommendation').textContent='请使用 Safari、Chrome 或 Edge';return;}
  const vs=window.speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang)).sort((a,b)=>voiceScore(b)-voiceScore(a));
  sel.innerHTML='<option value="">自动选择最自然语音（推荐）</option>'+vs.map(v=>`<option value="${esc(v.name)}">${esc(voiceLabel(v))}</option>`).join('');
  sel.value=state.settings.voice||'';
  const best=getVoice();$('voiceRecommendation').textContent=best?`当前推荐：${best.name} · ${best.lang}`:'当前浏览器尚未加载英文语音';
}
function openSettings(){$('rateRange').value=state.settings.rate;$('rateValue').textContent=state.settings.rate+'×';$('accentSelect').value=state.settings.accent||'auto';$('autoplayToggle').checked=state.settings.autoplay;$('retryToggle').checked=state.settings.retry;$('requeueToggle').checked=state.settings.requeue;fillVoices();$('settingsDialog').showModal()}
function saveSettings(){state.settings={rate:+$('rateRange').value,autoplay:$('autoplayToggle').checked,retry:$('retryToggle').checked,requeue:$('requeueToggle').checked,voice:$('voiceSelect').value,accent:$('accentSelect').value,natural:true};save(KEY.settings,state.settings)}
function openStats(){
  const vals=state.bank.map(x=>p(x.id)),learned=vals.filter(x=>x.attempts).length,a=vals.filter(x=>x.grade==='A').length;
  const totalAttempts=vals.reduce((s,x)=>s+(x.attempts||0),0),firstWrong=vals.reduce((s,x)=>s+(x.wrong||0),0),firstCorrect=Math.max(0,totalAttempts-firstWrong),wrongFav=vals.filter(x=>x.wrongStarred).length;
  $('statCards').innerHTML=[['已学习',`${learned}/${state.bank.length}`],['A级掌握',a],['收藏错题',wrongFav],['首次正确率',totalAttempts?Math.round(firstCorrect/totalAttempts*100)+'%':'—']].map(x=>`<div class="stat-card"><strong>${x[1]}</strong><span>${x[0]}</span></div>`).join('');
  $('masteryBars').innerHTML=themes().map(([t,n])=>{const done=state.bank.filter(x=>x.theme===t&&p(x.id).grade==='A').length;return `<div class="mastery-row"><span>${esc(t)}</span><div class="bar"><i style="width:${done/n*100}%"></i></div><b>${done}/${n}</b></div>`}).join('');$('statsDialog').showModal();
}
function download(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function readJson(file,cb){const r=new FileReader();r.onload=()=>{try{cb(JSON.parse(r.result))}catch{toast('JSON 文件格式错误')}};r.readAsText(file)}
function openSidebar(){$('sidebar').classList.add('open');$('sidebarBackdrop').classList.add('open')}
function closeSidebar(){$('sidebar').classList.remove('open');$('sidebarBackdrop').classList.remove('open')}
function bind(){
 $('startBtn').onclick=()=>state.status==='starred'?startFavoritePractice():startSession();
 $('playBtn').onclick=()=>speak();$('repeatBtn').onclick=()=>speak();$('slowBtn').onclick=()=>{state.slowUsed=true;speak(.8)};$('answerForm').onsubmit=submit;$('nextBtn').onclick=next;$('starBtn').onclick=toggleStar;
 $('meaningHintBtn').onclick=()=>{if(!state.current)return;state.hintUsed=true;$('hintBox').textContent=state.current.chunkZh+'（使用提示后，本题最高自动评为 B）';$('hintBox').classList.toggle('hidden')};
 document.querySelectorAll('[data-grade]').forEach(b=>b.onclick=()=>selectGrade(b.dataset.grade,true));
 document.querySelectorAll('#statusTabs button').forEach(b=>b.onclick=()=>{
   persistPendingGrade();
   document.querySelectorAll('#statusTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.status=b.dataset.status;
   if(state.status==='starred'){state.theme='all';renderThemes();showFavoriteLibrary();}else{renderThemes();startSession();}
 });
 $('practiceFavoritesBtn').onclick=startFavoritePractice;$('backFavoritesPracticeBtn').onclick=showFavoriteLibrary;$('favoriteSearch').oninput=renderFavoriteLibrary;$('favoriteSort').onchange=renderFavoriteLibrary;$('favoriteScope').onchange=renderFavoriteLibrary;
 $('favoritePracticeOrder').onchange=renderFavoriteLibrary;$('favoritePracticeLimit').onchange=renderFavoriteLibrary;
 $('backToTrainingBtn').onclick=()=>{persistPendingGrade();state.status='all';state.theme='all';document.querySelectorAll('#statusTabs button').forEach(x=>x.classList.toggle('active',x.dataset.status==='all'));renderThemes();startSession();};
 $('settingsBtn').onclick=openSettings;$('settingsDialog').addEventListener('close',saveSettings);$('rateRange').oninput=e=>$('rateValue').textContent=e.target.value+'×';$('accentSelect').onchange=fillVoices;$('voiceSelect').onchange=()=>{state.settings.voice=$('voiceSelect').value};$('previewVoiceBtn').onclick=()=>{saveSettings();speak(null,'Academic research provides valuable insights into contemporary society.')};$('statsBtn').onclick=openStats;$('manageBtn').onclick=()=>$('manageDialog').showModal();
 $('exportProgress').onclick=()=>download('PTE_FIBL_学习进度.json',{version:3,exportedAt:new Date().toISOString(),progress:state.progress});
 $('exportBank').onclick=()=>download('PTE_FIBL_题库.json',state.bank);
 $('importProgress').onchange=e=>e.target.files[0]&&readJson(e.target.files[0],obj=>{state.progress=obj.progress||obj;save(KEY.progress,state.progress);renderThemes();if(state.view==='favorites')renderFavoriteLibrary();toast('学习进度已导入')});
 $('importBank').onchange=e=>e.target.files[0]&&readJson(e.target.files[0],arr=>{if(!Array.isArray(arr)||!arr.every(x=>x.id&&x.word&&x.chunk&&x.theme)){toast('题库字段不完整');return}state.bank=arr;save(KEY.bank,state.bank);renderThemes();if(state.view==='favorites')renderFavoriteLibrary();toast(`已导入 ${arr.length} 个词`) });
 $('restoreBank').onclick=()=>{if(confirm('恢复内置 915 词题库？')){state.bank=BUILTIN;localStorage.removeItem(KEY.bank);renderThemes();if(state.view==='favorites')renderFavoriteLibrary();toast('已恢复内置题库')}};
 $('resetProgress').onclick=()=>{if(confirm('确定清空全部学习进度？此操作不可撤销。')){state.progress={};save(KEY.progress,{});renderThemes();if(state.view==='favorites')renderFavoriteLibrary();toast('学习进度已清空')}};
 $('openSidebar').onclick=openSidebar;$('closeSidebar').onclick=closeSidebar;$('sidebarBackdrop').onclick=closeSidebar;
 if('speechSynthesis' in window)window.speechSynthesis.onvoiceschanged=fillVoices;
 document.addEventListener('keydown',e=>{
   if(e.code==='Space'&&document.activeElement!==$('answerInput')&&!document.querySelector('dialog[open]')){e.preventDefault();speak()}
   if(e.key==='ArrowRight'&&!$('feedback').classList.contains('hidden'))next();
 });
 window.addEventListener('beforeunload',persistPendingGrade);
}
bind();renderThemes();fillVoices();startSession();
if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});if('caches' in window)caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fibl-')).map(k=>caches.delete(k)))).catch(()=>{});}
})();
