export class EnterprisePolicyClient {
  constructor(
    private readonly apiBaseUrl:string,
    private readonly getAccessToken:()=>Promise<string>
  ) {}

  async set(organizationId:string,key:string,value:unknown) {
    const token=await this.getAccessToken();
    const response=await fetch(
      `${this.apiBaseUrl}/v1/organizations/${organizationId}/policies/${encodeURIComponent(key)}`,
      {
        method:"PUT",
        headers:{
          "content-type":"application/json",
          authorization:`Bearer ${token}`
        },
        body:JSON.stringify({value})
      }
    );
    if(!response.ok)throw new Error("Policy update failed.");
  }
}
