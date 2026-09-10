export const engravingOptions={inputFrom:'xml',pageWidth:2160,pageHeight:2794,pageMarginLeft:95,pageMarginRight:95,pageMarginTop:80,pageMarginBottom:80,scale:50,adjustPageHeight:false,adjustPageWidth:false,font:'Bravura',header:'none',footer:'none',spacingSystem:16,lyricSize:3.8,lyricWordSpace:1.6,lyricNoStartHyphen:true};

// Format metadata travels with MusicXML; pitches, rhythms, and harmonies are untouched.
export function formatMusicXML(xml,Parser=globalThis.DOMParser,Serializer=globalThis.XMLSerializer){
 const doc=new Parser().parseFromString(xml,'application/xml'),root=doc.documentElement;
 let defaults=root.getElementsByTagName('defaults')[0];
 if(!defaults){defaults=doc.createElement('defaults');root.insertBefore(defaults,root.getElementsByTagName('part-list')[0]);}
 const make=(parent,tag,value)=>{const el=doc.createElement(tag);if(value!==undefined)el.textContent=String(value);parent.appendChild(el);return el;};
 const mm=Number(defaults.getElementsByTagName('millimeters')[0]?.textContent||7),tenths=Number(defaults.getElementsByTagName('tenths')[0]?.textContent||40);
 if(!defaults.getElementsByTagName('scaling').length){const scaling=doc.createElement('scaling');defaults.insertBefore(scaling,defaults.firstChild);make(scaling,'millimeters',7);make(scaling,'tenths',40);}
 for(const name of ['page-layout','system-layout','word-font','lyric-font'])for(const el of [...defaults.getElementsByTagName(name)])defaults.removeChild(el);
 const layout=doc.createElement('page-layout');const scaling=defaults.getElementsByTagName('scaling')[0];defaults.insertBefore(layout,scaling.nextSibling);
 make(layout,'page-height',(279.4/mm*tenths).toFixed(3));make(layout,'page-width',(216/mm*tenths).toFixed(3));const margins=make(layout,'page-margins');margins.setAttribute('type','both');for(const side of ['left','right','top','bottom'])make(margins,side+'-margin',(10/mm*tenths).toFixed(3));
 const system=doc.createElement('system-layout');defaults.insertBefore(system,layout.nextSibling);make(system,'system-distance','187.8');make(system,'top-system-distance','110');
 // Insert fonts in schema order, before lyric-language if present.
 for(const tag of ['word-font','lyric-font']){const font=doc.createElement(tag);font.setAttribute('font-family','Arial');font.setAttribute('font-size','10');defaults.insertBefore(font,defaults.getElementsByTagName('lyric-language')[0]||null);}
 return new Serializer().serializeToString(doc);
}

export function formatNotationSVG(markup,{fixedSystems=false,page=1,pageCount=1}={},Parser=globalThis.DOMParser,Serializer=globalThis.XMLSerializer){
 const doc=new Parser().parseFromString(markup,'image/svg+xml'),svg=doc.documentElement,ns='http://www.w3.org/2000/svg';
 const elements=[...svg.getElementsByTagName('*')],hasClass=(el,c)=>(' '+(el.getAttribute('class')||'')+' ').includes(' '+c+' ');
 for(const el of elements){if(!['text','tspan'].includes(el.localName||el.tagName))continue;const font=el.getAttribute('font-family')||'';if(!/Bravura|Leipzig|Petaluma|smufl/i.test(font))el.setAttribute('font-family','Arial, sans-serif');}
 if(fixedSystems){
  const pg=elements.find(el=>hasClass(el,'page-margin'));
  elements.filter(el=>hasClass(el,'system')).forEach((system,index)=>{const staff=[...system.getElementsByTagName('g')].find(el=>hasClass(el,'staff')),d=staff?.getElementsByTagName('path')[0]?.getAttribute('d'),m=d?.match(/^M\s*[\d.-]+[ ,]+([\d.-]+)/);if(m)system.setAttribute('transform',`translate(0 ${2800+index*4100-Number(m[1])})`);});
  const text=(value,x,y,size,anchor='start',weight='400')=>{const el=doc.createElementNS(ns,'text');for(const[k,v]of Object.entries({x,y,'font-size':size,'font-family':'Arial, sans-serif','text-anchor':anchor,'font-weight':weight}))el.setAttribute(k,String(v));el.textContent=value;pg.appendChild(el);};
  if(pg){text('GOLDEN LADY',0,650,660,'start','600');text('Stevie Wonder',19600,620,330,'end');text(page===1?'RHYTHM CHART':'GOLDEN LADY · CONTINUED',0,1180,240);text(`${page} / ${pageCount}`,19600,25800,260,'end');}
 }
 return new Serializer().serializeToString(doc);
}
