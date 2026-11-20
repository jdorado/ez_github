#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {cleanEnv,isClone,prepareClone,repos} from './repos.mjs';

export function command(args) {
  const [tool,...rest]=args;
  if(tool==='gh'||tool==='git') return [tool,rest];
  if(tool==='doctor') return ['gh',['auth','status','--hostname','github.com']];
  throw Error('Use --help, --version, doctor, repos, gh <args>, or git <args>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const args=process.argv.slice(2);
  if(args[0]==='--version') console.log('ez-github 0.1.0-beta.8');
  else if(!args.length||args[0]==='--help') console.log('ez github doctor | gh <native arguments> | git <native arguments> | repos clone|list|reclaim\nPrivate repositories: /repos. Native stdin, output and exit codes. Clones are bounded: see ez github repos --help. Read skills/github/SKILL.md for OAuth onboarding.');
  else if(args[0]==='repos') {
    try {await repos(args.slice(1));} catch(error) {console.error(error.message);process.exitCode=1;}
  } else {
    try {
      const [binary,argv]=command(args);
      if(isClone(args)) await prepareClone();
      const env=cleanEnv();
      const child=spawn(binary,argv,{stdio:'inherit',env,detached:true});
      let timer;
      const stop=signal=>{
        if(!child.pid) return;
        try {process.kill(-child.pid,signal);} catch(error) {if(error.code!=='ESRCH') throw error;}
        timer??=setTimeout(()=>{try {process.kill(-child.pid,'SIGKILL');} catch {}},2000);
      };
      const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
      process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
      child.on('error',error=>{console.error(error.message);process.exitCode=1;});
      child.on('close',(code,signal)=>{
        clearTimeout(timer);
        process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
        process.exitCode=code??(signal==='SIGINT'?130:143);
      });
    } catch(error) {console.error(error.message);process.exitCode=1;}
  }
}
