#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function command(args) {
  const [tool,...rest]=args;
  if(tool==='gh'||tool==='git') return [tool,rest];
  if(tool==='doctor') return ['gh',['auth','status','--hostname','github.com']];
  throw Error('Use --help, --version, doctor, gh <args>, or git <args>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const args=process.argv.slice(2);
  if(args[0]==='--version') console.log('ez-github 0.1.0-beta.3');
  else if(!args.length||args[0]==='--help') console.log('ez github doctor | gh <native arguments> | git <native arguments>\nPrivate repositories: /repos. Native stdin, output and exit codes. Read skills/github/SKILL.md for OAuth onboarding.');
  else {
    try {
      const [binary,argv]=command(args);
      const env={...process.env};
      delete env.GH_TOKEN;delete env.GITHUB_TOKEN;delete env.GH_ENTERPRISE_TOKEN;delete env.GITHUB_ENTERPRISE_TOKEN;
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
