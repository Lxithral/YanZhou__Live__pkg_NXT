(function(global){
  'use strict';
  var defaults={template:'g',customized:false,tagColor:'#ffb02e',tagTextColor:'#10131f',backgroundColor:'#0e1220',backgroundOpacity:96,textColor:'#f5f7ff',borderColor:'#ffffff',shape:'capsule',tagShape:'capsule',radius:null,tagRadius:null,footerLeft:'',footerAlign:'left'};
  var themes={
    g:{label:'G · 烟洲校色',tagColor:'#792b2d',tagTextColor:'#ffffff',backgroundColor:'#fbf9f5',backgroundOpacity:100,textColor:'#792b2d',borderColor:'#792b2d',shape:'square',tagShape:'square'},
    h:{label:'H · 烟洲新闻',tagColor:'#143b83',tagTextColor:'#ffffff',backgroundColor:'#ffffff',backgroundOpacity:100,textColor:'#123571',borderColor:'#ffffff',shape:'custom',tagShape:'square',radius:14,footerLeft:''},
    i:{label:'I · 烟洲印记',tagColor:'#792b2d',tagTextColor:'#ffffff',backgroundColor:'#ffffff',backgroundOpacity:100,textColor:'#58232c',borderColor:'#792b2d',shape:'small',tagShape:'small'}
  };
  function normalize(value){var source=value&&typeof value==='object'?value:{},out=Object.assign({},defaults);Object.keys(defaults).forEach(function(k){var v=source[k];if(/Color$/.test(k)&&typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)){out[k]=v.toLowerCase();}});if(themes[source.template]){out.template=source.template;}out.customized=source.customized===true;['shape','tagShape'].forEach(function(k){if(['square','small','round','capsule','cut','custom'].indexOf(source[k])>=0){out[k]=source[k];}});var opacity=Number(source.backgroundOpacity);if(source.backgroundOpacity!=null&&Number.isFinite(opacity)){out.backgroundOpacity=Math.max(0,Math.min(100,Math.trunc(opacity)));}['radius','tagRadius'].forEach(function(k){var v=Number(source[k]);if(source[k]!=null&&Number.isFinite(v)){out[k]=Math.max(0,Math.min(k==='radius'?24:16,Math.trunc(v)));}if(out[k]===null&&out[k==='radius'?'shape':'tagShape']==='custom'){out[k]=16;}});out.footerLeft=String(source.footerLeft||'').slice(0,80);if(['left','center','right'].indexOf(source.footerAlign)>=0){out.footerAlign=source.footerAlign;}return out;}
  function template(key){return normalize(Object.assign({},defaults,themes[key]||{}, {template:themes[key]?key:'g'}));}
  function decode(value){try{return normalize(typeof value==='string'?JSON.parse(value):value);}catch(e){return normalize();}}
  function apply(node,value){if(!node){return;}var a=normalize(value),rgb=a.backgroundColor.match(/[0-9a-f]{2}/g).map(function(v){return parseInt(v,16);});node.classList.add('host-visual');node.dataset.template=a.template;node.dataset.customized=String(a.customized);node.dataset.shape=a.shape;node.dataset.tagShape=a.tagShape;node.dataset.footerAlign=a.footerAlign;node.style.setProperty('--host-custom-radius',(a.radius==null?16:a.radius)+'px');node.style.setProperty('--host-custom-tag-radius',(a.tagRadius==null?16:a.tagRadius)+'px');node.style.setProperty('--host-bg','rgba('+rgb.join(',')+','+a.backgroundOpacity/100+')');node.style.setProperty('--host-bg-end','rgba('+rgb.map(function(v){return Math.round(v*.6);}).join(',')+','+a.backgroundOpacity/100+')');['tagColor','tagTextColor','textColor','borderColor'].forEach(function(k){node.style.setProperty('--host-'+k,a[k]);});}
  function renderText(node,data){
    var tag=node.querySelector('.tag'),names=node.querySelector('.names'),sub=node.querySelector('.sub');
    if(!tag||!names||!sub){return;}tag.textContent=data.title||'主持人';
    if(node.dataset.template==='h'){
      var values=String(data.names||'').split(/[、,，;；\n]+/).map(function(v){return v.trim();}).filter(Boolean).slice(0,2);
      node.dataset.hostCount=String(values.length);
      var signature=JSON.stringify(values);if(names.dataset.signature!==signature||!names.querySelector('.host-name')){if(!names.querySelector('.host-name')){names.textContent='';[0,1].forEach(function(i){var item=document.createElement('span');item.className='host-name host-name-'+i;names.appendChild(item);});}[0,1].forEach(function(i){names.children[i].textContent=values[i]||'';});names.dataset.signature=signature;}
      var appearance=normalize(data.appearance),footer=JSON.stringify([appearance.footerLeft,data.subtitle||'']);
      if(sub.dataset.signature!==footer||!sub.querySelector('.host-footer-left')){sub.textContent='';['left','right'].forEach(function(side,i){var item=document.createElement('span');item.className='host-footer-'+side;item.textContent=i?data.subtitle||'':appearance.footerLeft;sub.appendChild(item);});sub.dataset.signature=footer;}
      sub.classList.remove('hidden');
    }else{delete node.dataset.hostCount;names.textContent=String(data.names||'').replace(/[、,，;；]+/g,'　　');sub.textContent=data.subtitle||'';sub.classList.toggle('hidden',!String(data.subtitle||'').trim());delete names.dataset.signature;delete sub.dataset.signature;}
  }
  var duration=480,easing='cubic-bezier(.22,.8,.3,1)';
  function parts(node){var result={};['host-shell','tag','names','host-name-0','host-name-1','sub','host-footer-left','host-footer-right'].forEach(function(key){var item=node.querySelector('.'+key);if(item&&getComputedStyle(item).visibility!=='hidden'){var rect=item.getBoundingClientRect();if(rect.width&&rect.height){result[key]={node:item,rect:rect,text:item.textContent};}}});return result;}
  function picture(item){var clone=item.cloneNode(true),originals=[item].concat(Array.from(item.querySelectorAll('*'))),copies=[clone].concat(Array.from(clone.querySelectorAll('*')));copies.forEach(function(copy,i){var style=getComputedStyle(originals[i]);for(var j=0;j<style.length;j++){copy.style.setProperty(style[j],style.getPropertyValue(style[j]));}copy.removeAttribute('id');copy.removeAttribute('class');});return clone;}
  function stop(node){(node._hostVisualAnimations||[]).forEach(function(track){track.animation.cancel();if(track.ghost){track.ghost.remove();}});node._hostVisualAnimations=[];}
  function play(node,item,frames,ghost){var animation=item.animate(frames,{duration:duration,easing:easing,fill:'none'}),track={animation:animation,ghost:ghost};node._hostVisualAnimations.push(track);animation.onfinish=function(){if(ghost){ghost.remove();}var index=node._hostVisualAnimations.indexOf(track);if(index>=0){node._hostVisualAnimations.splice(index,1);}};}
  function update(node,data,afterLayout,options){
    if(!node){return;}var signature=JSON.stringify([normalize(data.appearance),data.title,data.names,data.subtitle,data.animation]);
    if(node._hostVisualSignature===signature){if(afterLayout){afterLayout();}return;}
    var rect=node.getBoundingClientRect(),scale=rect.width/(node.offsetWidth||1),animate=typeof node.animate==='function'&&!!node._hostVisualSignature&&rect.width>0&&!node.classList.contains('hidden')&&data.animation!=='none'&&!global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var textSignature=JSON.stringify([data.title,data.names,data.subtitle,normalize(data.appearance).footerLeft]),time=Date.now(),textChanged=node._hostTextSignature!==textSignature;
    var textMotion=(!options||options.textMotion!==false)&&!(textChanged&&time-(node._hostLastTextAt||0)<duration);
    if(textChanged){node._hostTextSignature=textSignature;node._hostLastTextAt=time;}
    var previous=animate?parts(node):{},themeChanged=node.dataset.template!==normalize(data.appearance).template;
    if(animate){Object.keys(previous).forEach(function(key){if((key!=='host-shell'&&!/^host-footer-/.test(key)&&textMotion)||(key==='host-shell'&&themeChanged)){previous[key].picture=picture(previous[key].node);}});}
    stop(node);
    if(!node.querySelector('.host-shell')){var shell=document.createElement('span');shell.className='host-shell';shell.setAttribute('aria-hidden','true');node.appendChild(shell);}
    node.dataset.visualMotion=data.animation==='none'?'none':'smooth';apply(node,data.appearance);renderText(node,data);if(afterLayout){afterLayout();}node._hostVisualSignature=signature;
    if(!animate){return;}var current=parts(node),root=node.getBoundingClientRect(),unit=root.width/(node.offsetWidth||1);
    Object.keys(current).forEach(function(key){var now=current[key],old=previous[key],dx=old?(old.rect.left-now.rect.left)/unit:0,dy=old?(old.rect.top-now.rect.top)/unit:6,sx=key==='host-shell'&&old?old.rect.width/now.rect.width:1,sy=key==='host-shell'&&old?old.rect.height/now.rect.height:1;
      if(old&&/^host-name-/.test(key)){dx+=(old.rect.width-now.rect.width)/unit/2;}var changed=!old||old.text!==now.text||(key==='host-shell'&&themeChanged);
      if(Math.abs(dx)>.1||Math.abs(dy)>.1||Math.abs(sx-1)>.001||Math.abs(sy-1)>.001||(changed&&textMotion)){now.node.style.transformOrigin='0 0';play(node,now.node,[{transform:'translate('+dx+'px,'+dy+'px) scale('+sx+','+sy+')',opacity:changed&&textMotion&&key!=='host-shell'?0:1},{transform:'none',opacity:1}]);}
    });
    Object.keys(previous).forEach(function(key){var old=previous[key],now=current[key];if(!old.picture||(now&&old.text===now.text&&key!=='host-shell')){return;}var ghost=old.picture;if(key==='host-shell'){ghost.className='host-background-ghost';ghost.setAttribute('aria-hidden','true');Object.assign(ghost.style,{position:'absolute',left:(old.rect.left-root.left)/unit+'px',top:(old.rect.top-root.top)/unit+'px',right:'auto',bottom:'auto',width:old.rect.width/unit+'px',height:old.rect.height/unit+'px',margin:'0',boxSizing:'border-box',transform:'none',transition:'none',animation:'none',pointerEvents:'none',zIndex:'-1'});node.insertBefore(ghost,node.firstChild);play(node,ghost,[{opacity:1},{opacity:0}],ghost);return;}ghost.setAttribute('aria-hidden','true');ghost.className='host-transition-ghost';Object.assign(ghost.style,{position:'fixed',left:old.rect.left+'px',top:old.rect.top+'px',right:'auto',bottom:'auto',width:old.rect.width/scale+'px',height:old.rect.height/scale+'px',margin:'0',boxSizing:'border-box',transformOrigin:'0 0',transform:'scale('+scale+')',transition:'none',animation:'none',pointerEvents:'none',zIndex:'100000',visibility:'visible'});document.body.appendChild(ghost);play(node,ghost,[{opacity:1,transform:'scale('+scale+')'},{opacity:0,transform:'scale('+scale+') translateY(-4px)'}],ghost);});
  }
  function presetPreview(preset){
    var frame=document.createElement('span'),visual=document.createElement('span');
    frame.className='host-preset-preview';
    frame.setAttribute('aria-hidden','true');
    visual.className='host-visual';
    visual.innerHTML='<span class="tag"></span><span class="names"></span><span class="sub"></span>';
    update(visual,{title:preset.title||'主持人',names:preset.names||preset.label,subtitle:preset.subtitle,appearance:preset.appearance,animation:'none'});
    frame.appendChild(visual);
    return frame;
  }
  global.HostAppearance={presetPreview:presetPreview,defaults:defaults,themes:themes,normalize:normalize,decode:decode,template:template,apply:apply,renderText:renderText,update:update};
})(window);
