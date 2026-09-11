// Books and Sets: named lists of charts. A book is an unordered collection; a set is an
// ordered performance list whose entries may carry their own key. Pure helpers only.
import {mod,chooseFifths} from './music.mjs';
export const LIST_KINDS=['book','set'];
export function newList(kind,name){if(!LIST_KINDS.includes(kind))throw Error('Unknown list kind');return{id:crypto.randomUUID(),kind,name:name.trim(),items:[],createdAt:Date.now(),updatedAt:Date.now()};}
export function listPayload(list){return{kind:list.kind,name:list.name,items:list.items.map(item=>item.fifths==null?{id:item.id}:{id:item.id,fifths:item.fifths}),createdAt:list.createdAt||Date.now(),updatedAt:list.updatedAt||Date.now()};}
export function hasItem(list,scoreId){return list.items.some(item=>item.id===scoreId);}
export function addItem(list,scoreId){if(list.kind==='book'&&hasItem(list,scoreId))return false;list.items.push({id:scoreId});list.updatedAt=Date.now();return true;}
export function removeItemAt(list,index){if(index<0||index>=list.items.length)return false;list.items.splice(index,1);list.updatedAt=Date.now();return true;}
export function removeScoreFromList(list,scoreId){const before=list.items.length;list.items=list.items.filter(item=>item.id!==scoreId);if(list.items.length!==before){list.updatedAt=Date.now();return true;}return false;}
export function moveItem(list,from,to){if(from===to||from<0||to<0||from>=list.items.length||to>=list.items.length)return false;const [item]=list.items.splice(from,1);list.items.splice(to,0,item);list.updatedAt=Date.now();return true;}
export function stripFromLists(lists,scoreId){return lists.filter(list=>removeScoreFromList(list,scoreId));}
// The key a chart plays in: a set entry's own key wins over the chart's saved key.
export function resolveKey(score,entry){
 const base=score.info?.fifths??0;
 if(entry&&entry.fifths!=null){let semitones=mod((entry.fifths-base)*7,12);if(semitones>6)semitones-=12;return{fifths:entry.fifths,semitones,fromSet:true};}
 return{fifths:score.targetFifths??base,semitones:score.semitones||0,fromSet:false};
}
export function entryKeyForStep(score,semitones,targetFifths){return targetFifths??chooseFifths(score.info.fifths,semitones);}
// Merge remote list changes into the local list array. Remote wins when it is at least as new.
export function reconcileLists(lists,changes){
 const removed=[],changed=[];
 for(const change of changes){
  const index=lists.findIndex(l=>l.id===change.id);
  if(change.type==='removed'){if(index>=0){lists.splice(index,1);removed.push(change.id);}continue;}
  const remote={id:change.id,...change.meta,synced:true};
  if(index<0){lists.push(remote);changed.push(change.id);continue;}
  if((lists[index].updatedAt||0)>(remote.updatedAt||0)&&!lists[index].synced)continue;
  if((lists[index].updatedAt||0)>=(remote.updatedAt||0)&&lists[index].synced)continue;
  lists[index]=remote;changed.push(change.id);
 }
 return{removed,changed};
}
