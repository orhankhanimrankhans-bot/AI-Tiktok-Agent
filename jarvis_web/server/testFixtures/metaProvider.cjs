// Test process only. Every external fetch is intercepted; no real provider is contacted.
globalThis.fetch = async function(input,options={}) {
 const url=new URL(input),header=options.headers?.Authorization || '';
 if(url.hostname!=='graph.facebook.com')throw new Error('External network is disabled in Meta HTTP tests');
 const ok=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 if(url.pathname.endsWith('/oauth/access_token')) {
  const form=new URLSearchParams(options.body),app=form.get('client_id');
  if(form.get('client_secret')!=='http-private-app-'+app)throw new Error('Wrong test application binding');
  return ok({access_token:'http-private-user-'+app,token_type:'bearer',expires_in:3600});
 }
 if(url.pathname.endsWith('/debug_token')) {
  const app=header.replace('Bearer ','').split('|')[0];
  return ok({data:{is_valid:true,app_id:app}});
 }
 const app=header.includes('222222')?'222222':'111111';
 if(url.pathname.endsWith('/me/accounts'))return ok({data:[{id:app==='111111'?'700001':'700002',name:'Workspace Page',access_token:'http-private-page-'+app}]});
 if(url.pathname.endsWith('/me/permissions'))return ok({data:[{permission:'pages_manage_posts',status:'granted'}]});
 if(url.pathname.endsWith('/me'))return ok({id:app==='111111'?'800001':'800002',name:'Workspace Person',session_token:'http-private-provider-session'});
 if(/\/70000[12]$/.test(url.pathname))return ok({id:url.pathname.split('/').pop(),name:'Workspace Page'});
 throw new Error('Unexpected Meta fixture request');
};
