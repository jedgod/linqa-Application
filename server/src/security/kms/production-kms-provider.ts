import { DecryptCommand,DescribeKeyCommand,EncryptCommand,GenerateDataKeyCommand,KMSClient } from "@aws-sdk/client-kms";

export interface KmsHealth {state:"READY"|"DEGRADED";keyId:string;checkedAt:string;reason?:string}
export interface ProductionKmsProvider {encrypt(input:{plaintext:Buffer;context:Record<string,string>}):Promise<Buffer>;decrypt(input:{ciphertext:Buffer;context:Record<string,string>}):Promise<Buffer>;generateDataKey(input:{context:Record<string,string>}):Promise<{plaintext:Buffer;ciphertext:Buffer}>;health():Promise<KmsHealth>}

export class AwsProductionKmsProvider implements ProductionKmsProvider {
  private readonly client:KMSClient;
  constructor(private readonly keyId:string,region:string,client?:KMSClient){if(!keyId||!region)throw new Error("KMS_CONFIGURATION_REQUIRED");this.client=client??new KMSClient({region});}
  async encrypt(input:{plaintext:Buffer;context:Record<string,string>}){const result=await this.client.send(new EncryptCommand({KeyId:this.keyId,Plaintext:input.plaintext,EncryptionContext:input.context}));if(!result.CiphertextBlob)throw new Error("KMS_CIPHERTEXT_MISSING");return Buffer.from(result.CiphertextBlob);}
  async decrypt(input:{ciphertext:Buffer;context:Record<string,string>}){const result=await this.client.send(new DecryptCommand({KeyId:this.keyId,CiphertextBlob:input.ciphertext,EncryptionContext:input.context}));if(!result.Plaintext)throw new Error("KMS_PLAINTEXT_MISSING");return Buffer.from(result.Plaintext);}
  async generateDataKey(input:{context:Record<string,string>}){const result=await this.client.send(new GenerateDataKeyCommand({KeyId:this.keyId,KeySpec:"AES_256",EncryptionContext:input.context}));if(!result.Plaintext||!result.CiphertextBlob)throw new Error("KMS_DATA_KEY_MISSING");return{plaintext:Buffer.from(result.Plaintext),ciphertext:Buffer.from(result.CiphertextBlob)};}
  async health():Promise<KmsHealth>{try{const result=await this.client.send(new DescribeKeyCommand({KeyId:this.keyId}));const ready=result.KeyMetadata?.Enabled===true&&result.KeyMetadata.KeyState==="Enabled";return{state:ready?"READY":"DEGRADED",keyId:this.keyId,checkedAt:new Date().toISOString(),...(ready?{}:{reason:`KMS_KEY_${result.KeyMetadata?.KeyState??"UNKNOWN"}`})};}catch(error){return{state:"DEGRADED",keyId:this.keyId,checkedAt:new Date().toISOString(),reason:error instanceof Error?error.message:"KMS_HEALTH_FAILED"};}}
}
