"use strict";
class InstagramError extends Error { constructor(code,message,statusCode=400){super(message);this.code=`instagram_${code}`;this.statusCode=statusCode;} }
class InstagramApi {
  constructor({fetchImpl=fetch,version="v26.0"}={}) {this.fetch=fetchImpl;this.version=version;}
  async request(url,{method="GET",form,token}={}) {
    try {
      const response=await this.fetch(url,{method,redirect:"error",signal:AbortSignal.timeout(30000),headers:{...(token?{Authorization:`Bearer ${token}`}:{})},...(form?{body:new URLSearchParams(form)}:{})});
      const data=await response.json();
      if(!response.ok || data.error) {
        if(response.status===401 || data.error?.code===190)throw new InstagramError("reconnect","Reconnect Instagram; its authorization expired or was revoked.",401);
        if(response.status===429 || [4,32,613].includes(data.error?.code))throw new InstagramError("rate_limit","Instagram's request limit was reached. Check status before retrying.",429);
        throw new InstagramError("provider_rejected","Instagram rejected this request. Check app publishing permissions, account access, and video requirements.",502);
      }
      return data;
    }catch(error){if(error instanceof InstagramError)throw error;throw new InstagramError("unavailable","Instagram could not confirm the request. Check the existing post status before retrying.",502);}
  }
  graph(endpoint,token,form) {return this.request(`https://graph.instagram.com/${this.version}/${endpoint}`,{token,...(form?{method:"POST",form}:{})});}
  async exchange(config,code,redirectUri) {
    const raw=await this.request("https://api.instagram.com/oauth/access_token",{method:"POST",form:{client_id:config.appId,client_secret:config.appSecret,grant_type:"authorization_code",redirect_uri:redirectUri,code}});
    const short=raw.data?.[0]||raw;
    if(!short.access_token)throw new InstagramError("token_missing","Instagram did not grant access.");
    const url=new URL("https://graph.instagram.com/access_token");url.search=new URLSearchParams({grant_type:"ig_exchange_token",client_secret:config.appSecret,access_token:short.access_token});
    const long=await this.request(url);
    if(!long.access_token || !Number.isFinite(long.expires_in))throw new InstagramError("token_missing","Instagram did not provide a usable long-lived token.");
    const profile=await this.graph("me?fields=user_id,username",long.access_token);
    const id=String(profile.user_id||profile.id||"");
    if(!/^\d+$/.test(id) || !profile.username)throw new InstagramError("profile_missing","Instagram account identity could not be verified.");
    return {id,name:profile.username,accessToken:long.access_token,expiresAt:Date.now()+long.expires_in*1000,refreshedAt:Date.now(),revision:config.revision};
  }
  async access(account) {
    if(account.expiresAt<=Date.now())throw new InstagramError("reconnect","Reconnect Instagram; its authorization expired.",401);
    if(account.expiresAt-Date.now()>7*86400000)return account;
    const url=new URL("https://graph.instagram.com/refresh_access_token");url.search=new URLSearchParams({grant_type:"ig_refresh_token",access_token:account.accessToken});
    const data=await this.request(url);
    if(!data.access_token || !Number.isFinite(data.expires_in))throw new InstagramError("refresh_failed","Reconnect Instagram to renew authorization.",401);
    return {...account,accessToken:data.access_token,expiresAt:Date.now()+data.expires_in*1000,refreshedAt:Date.now()};
  }
}
module.exports={InstagramApi,InstagramError};
