type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

const senderAddress=()=>{
  const value=(process.env.OPSVISTA_EMAIL_FROM||'OpsVista <alerts@getopsvista.com>').trim();
  const match=value.match(/<([^>]+)>/);
  return (match?.[1]||value).trim().toLowerCase();
};

export default async function handler(_req:unknown,res:ApiResponse){
  res.setHeader?.('Cache-Control','no-store');
  const apiKey=process.env.RESEND_API_KEY?.trim()||'';
  const from=senderAddress();
  const domain=from.split('@')[1]||'';
  if(!apiKey)return res.status(200).json({senderConfigured:false,apiKeyValid:false,from,domain,domainFound:false,domainStatus:'unconfigured',sending:'disabled'});
  try{
    const response=await fetch('https://api.resend.com/domains?limit=100',{
      headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)return res.status(200).json({senderConfigured:true,apiKeyValid:false,from,domain,domainFound:false,domainStatus:'unknown',sending:'unknown',providerStatus:response.status});
    const body=await response.json().catch(()=>({})) as {data?:Array<{name?:string;status?:string;capabilities?:{sending?:string}}>} ;
    const found=(body.data||[]).find(item=>item.name?.toLowerCase()===domain.toLowerCase());
    return res.status(200).json({
      senderConfigured:true,
      apiKeyValid:true,
      from,
      domain,
      domainFound:Boolean(found),
      domainStatus:found?.status||'not_found',
      sending:found?.capabilities?.sending||'unknown',
    });
  }catch{
    return res.status(200).json({senderConfigured:true,apiKeyValid:'unknown',from,domain,domainFound:'unknown',domainStatus:'unreachable',sending:'unknown'});
  }
}
