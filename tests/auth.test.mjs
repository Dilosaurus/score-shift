import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isEmail,displayName,initials,continueUrl,EMAIL_KEY} from '../dist/auth.mjs';

test('email addresses are checked loosely but reject obvious junk',()=>{
 assert.equal(isEmail('dad@example.com'),true);assert.equal(isEmail('  Dad@Example.co '),true);
 assert.equal(isEmail('dad'),false);assert.equal(isEmail('dad@'),false);assert.equal(isEmail('a b@c.d'),false);assert.equal(isEmail(''),false);assert.equal(isEmail(null),false);
});

test('a person is shown by name, then by the part of the email before @',()=>{
 assert.equal(displayName({displayName:'Chris D',email:'c@x.com'}),'Chris D');
 assert.equal(displayName({displayName:'  ',email:'dad@example.com'}),'dad');
 assert.equal(displayName({}),'Musician');assert.equal(displayName(null),'');
 assert.equal(initials('Chris DiLorenzo'),'CD');assert.equal(initials('dad'),'D');assert.equal(initials('  '),'?');assert.equal(initials('a b c'),'AB');
});

test('the email link returns to the page and keeps a pending invite, dropping everything else',()=>{
 const loc={origin:'https://scoreshift-reader.web.app',pathname:'/',search:'?join=abc&library=old&utm=1&score=x'};
 assert.equal(continueUrl(loc),'https://scoreshift-reader.web.app/?join=abc&score=x');
 assert.equal(continueUrl({origin:'https://scoreshift-reader.web.app',pathname:'/',search:''}),'https://scoreshift-reader.web.app/');
 assert.equal(EMAIL_KEY,'scoreshift-signin-email');
});
