// Live end-to-end check of the band directory against the deployed Firestore rules, as a throwaway
// email/password account. Creates a band, resolves it the way a fresh launch does, then deletes
// everything it made. Run from the project root: node tests/e2e-bands.mjs
import {initializeApp} from 'firebase/app';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,deleteUser} from 'firebase/auth';
import * as fs from 'firebase/firestore';
import {firebaseConfig} from '../dist/firebase-config.mjs';
import {createDirectory} from '../dist/bands.mjs';

const app=initializeApp(firebaseConfig,'songbook');
const auth=getAuth(app),db=fs.getFirestore(app);
const email=`e2e-${Date.now()}@scoreshift.invalid`,password='e2e-'+Math.random().toString(36).slice(2);
const log=(...a)=>console.log(...a);
let user;
try{user=(await createUserWithEmailAndPassword(auth,email,password)).user;}
catch(e){console.error('signup failed',e.code,e.message);process.exit(1);}
log('signed up',user.uid);
const dir=createDirectory({fb:fs,db,uid:user.uid});
try{
 await dir.saveProfile({name:'E2E',email});
 log('bands before:',JSON.stringify(await dir.myBands()));
 const band=await dir.createBand('E2E band','E2E');
 log('created',band.id);
 // a fresh launch: sign in again on a new app instance and resolve bands
 const app2=initializeApp(firebaseConfig,'launch2');const auth2=getAuth(app2),db2=fs.getFirestore(app2);
 const u2=(await signInWithEmailAndPassword(auth2,email,password)).user;
 const dir2=createDirectory({fb:fs,db:db2,uid:u2.uid});
 const mine=await dir2.myBands();
 log('bands on relaunch:',JSON.stringify(mine));
 if(!mine.bands.length)log('BUG REPRODUCED: relaunch sees no bands');
 if(typeof dir2.deleteBand==='function'){await dir2.deleteBand(band.id);log('deleted band; bands now:',JSON.stringify(await dir2.myBands()));}
 else log('deleteBand not implemented yet');
}catch(e){console.error('E2E FAILURE',e.code||'',e.message);}
finally{
 try{await deleteUser(auth.currentUser);log('deleted user');}catch(e){console.error('could not delete user',e.code,e.message);}
 process.exit(0);
}
