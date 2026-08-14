import type { Database } from "../db/pool.js";

export class AiJobService {
  constructor(private readonly db: Database) {}

  async create(input:{
    userId:string;
    conversationId?:string;
    jobType:string;
    privacyMode:"ON_DEVICE"|"CONFIDENTIAL_CLOUD"|"DISABLED";
    inputCiphertext?:Buffer;
  }) {
    if (input.privacyMode==="DISABLED") throw new Error("AI disabled");
    if (
      input.privacyMode==="CONFIDENTIAL_CLOUD" &&
      (!input.inputCiphertext || input.inputCiphertext.length<16)
    ) throw new Error("encrypted input required");

    const result=await this.db.query(
      `INSERT INTO ai_processing_jobs(
         user_id,conversation_id,job_type,privacy_mode,input_ciphertext,expires_at
       ) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours')
       RETURNING id,status,created_at`,
      [
        input.userId,
        input.conversationId??null,
        input.jobType,
        input.privacyMode,
        input.inputCiphertext??null
      ]
    );

    return result.rows[0];
  }
}
