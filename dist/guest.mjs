// Browsing without an account. A guest plays from this device only: the charts they import and
// the binders and setlists they make live in the device cache under the GUEST_BAND scope, catalog
// charts are fetched from hosting, and nothing touches Firestore. Signing in later OFFERS to bring
// the device's charts into the person's band; it never moves them silently. Pure helpers only;
// app.mjs wires them to the screen.
export const GUEST_BAND='device';
export const GUEST_KEY='scoreshift-guest';
// What the app boots into. A signed-in person always goes straight in. A pending email link or a
// band invite needs the sign-in screen even for a remembered guest (the link or invite is why they
// are here). Otherwise a remembered guest goes straight to the device space and everyone else sees
// the sign-in screen, which has the guest door on it.
export function bootMode({user=null,pendingLink=false,pendingJoin=false,rememberedGuest=false}={}){
 if(user)return 'signed-in';
 if(pendingLink||pendingJoin)return 'signin';
 return rememberedGuest?'guest':'signin';
}
// The charts and lists a signed-in person can bring in from the device: previews never count, and
// a chart the band already holds under the same id (a catalog reference) is skipped, so a list
// item that pointed at the device's copy keeps pointing at the band's copy.
export function planBringIn(bandScores,deviceScores,deviceLists=[]){
 const have=new Set((bandScores||[]).map(s=>s.id));
 const candidates=(deviceScores||[]).filter(s=>s&&s.id&&!s.preview&&!s.reviewPreview);
 const bring=candidates.filter(s=>!have.has(s.id)),skipped=candidates.filter(s=>have.has(s.id));
 const lists=(deviceLists||[]).filter(l=>l&&l.id&&Array.isArray(l.items));
 return{bring,skipped,lists};
}
// One sentence for the offer box: what is waiting on the device.
export function leftoverSentence(scores,lists){
 const n=scores.length,m=lists.length;if(!n&&!m)return '';
 const parts=[];if(n)parts.push(`${n} chart${n===1?'':'s'}`);if(m)parts.push(`${m} binder${m===1?'':'s'} or setlist${m===1?'':'s'}`);
 return `${parts.join(' and ')} from before you signed in ${n+m===1?'is':'are'} still on this device.`;
}
