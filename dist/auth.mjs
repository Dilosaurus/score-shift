// Sign-in for ScoreShift: Google, or a passwordless email link. The Firebase Auth SDK is
// loaded only by connect(); the pure helpers are exported for tests. The Firebase app is
// shared with songbook.mjs (same app name) so Firestore requests carry the signed-in user.
import {firebaseConfig,firebaseSdkVersion} from './firebase-config.mjs';
export const EMAIL_KEY='scoreshift-signin-email';
export function isEmail(text){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(text||'').trim());}
export function displayName(user){
 if(!user)return '';
 const name=(user.displayName||'').trim();if(name)return name;
 const email=(user.email||'').trim();return email?email.split('@')[0]:'Musician';
}
export function initials(name){return String(name||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')||'?';}
// The address the email link should bring the person back to: the current page, keeping a
// pending band invite so the join completes after sign-in.
export function continueUrl(loc=location){
 const params=new URLSearchParams(loc.search),keep=new URLSearchParams();
 for(const key of ['join','score','review'])if(params.has(key))keep.set(key,params.get(key));
 return loc.origin+loc.pathname+(keep.toString()?'?'+keep:'');
}
async function loadSdk(){
 const base=`https://www.gstatic.com/firebasejs/${firebaseSdkVersion}`;
 const [app,auth]=await Promise.all([import(`${base}/firebase-app.js`),import(`${base}/firebase-auth.js`)]);
 return{...app,...auth};
}
export function createAuth({sdk,config=firebaseConfig,onUser=()=>{},storage=globalThis.localStorage}={}){
 let fb,auth,unsubscribe;
 const app=()=>fb.getApps().find(a=>a.name==='songbook')||fb.initializeApp(config,'songbook');
 async function connect(){
  fb=sdk||await loadSdk();auth=fb.getAuth(app());
  try{await fb.setPersistence(auth,fb.browserLocalPersistence);}catch(e){console.warn('auth persistence',e);}
  const pendingLink=fb.isSignInWithEmailLink(auth,location.href);
  const user=await new Promise(resolve=>{unsubscribe=fb.onAuthStateChanged(auth,u=>{resolve(u);onUser(u);});});
  let redirectError=null,redirected=null;
  try{redirected=(await fb.getRedirectResult(auth))?.user||null;}catch(e){redirectError=e;}
  const current=auth.currentUser||redirected||user;if(current&&current!==user)onUser(current);
  return{user:current,pendingLink,rememberedEmail:storage?.getItem(EMAIL_KEY)||'',redirectError};
 }
 async function google(){
  const provider=new fb.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  try{const result=await fb.signInWithPopup(auth,provider);return result.user;}
  catch(e){
   if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/cancelled-popup-request'].includes(e.code)){await fb.signInWithRedirect(auth,provider);return null;}
   if(e.code==='auth/popup-closed-by-user')throw Error('The Google window was closed before signing in.');
   throw e;
  }
 }
 async function sendEmailLink(email){
  email=String(email||'').trim().toLowerCase();if(!isEmail(email))throw Error('Enter the email address to send the sign-in link to.');
  await fb.sendSignInLinkToEmail(auth,email,{url:continueUrl(),handleCodeInApp:true});
  storage?.setItem(EMAIL_KEY,email);return email;
 }
 async function completeEmailLink(email){
  email=String(email||storage?.getItem(EMAIL_KEY)||'').trim().toLowerCase();
  if(!isEmail(email))throw Error('Confirm the email address the link was sent to.');
  const result=await fb.signInWithEmailLink(auth,email,location.href);
  storage?.removeItem(EMAIL_KEY);
  const params=new URLSearchParams(location.search);for(const key of ['apiKey','oobCode','mode','lang','continueUrl'])params.delete(key);
  history.replaceState(null,'',location.pathname+(params.toString()?'?'+params:'')+location.hash);
  return result.user;
 }
 async function signOut(){await fb.signOut(auth);}
 async function setName(name){if(!auth.currentUser)return;await fb.updateProfile(auth.currentUser,{displayName:String(name||'').trim().slice(0,60)});onUser(auth.currentUser);}
 function current(){return auth?.currentUser||null;}
 function stop(){unsubscribe?.();unsubscribe=null;}
 return{connect,google,sendEmailLink,completeEmailLink,signOut,setName,current,stop};
}
