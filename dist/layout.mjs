// Fit a chart onto as many pages as its source: Real Book pages hold up to ten systems, so
// a chart keeps its encoded line breaks ("line" mode) and steps down in size and spacing
// until Verovio paginates it into no more pages than the original scan had.
export const FIT_LADDER=[[50,16,80],[47,13,80],[44,11,70],[42,9,60],[40,8,50],[38,7,50],[36,6,40],[34,5,40],[32,4,36],[30,4,32]];
export function baseOptions(engravingOptions,score){
 const encoded=score.info?.layout==='encoded';
 return{...engravingOptions,breaks:score.visualFull?'encoded':encoded?'line':'auto',header:encoded?'auto':'none',...(encoded?{minLastJustification:0}:{})};
}
export function targetPages(score){return!score.visualFull&&Number.isInteger(score.pages)&&score.pages>0&&score.pages<=4?score.pages:null;}
// measure(options) must return the page count Verovio produces for those options.
export function fitLayout(base,target,measure){
 let last=null;
 for(const [scale,spacingSystem,margin] of FIT_LADDER){
  const options={...base,scale,spacingSystem,pageMarginTop:margin,pageMarginBottom:margin};
  const pages=measure(options);last={options,pages,scale,fits:pages<=target};
  if(last.fits)return last;
 }
 return last;
}
