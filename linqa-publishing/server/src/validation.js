import {z} from 'zod';
export const uuid=z.string().uuid();
export const eventInput=z.object({
 title:z.string().trim().min(1).max(200),description:z.string().max(5000).default(''),
 startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}).nullable().optional(),
 timezone:z.string().min(1).max(80),location:z.string().max(500).default(''),
 coordinates:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).nullable().optional(),
 visibility:z.enum(['public','country','community','private']).default('public'),
 feelingActivity:z.string().max(120).nullable().optional(),
 uploadIds:z.array(uuid).max(10).default([])
}).strict().refine(x=>!x.endsAt||Date.parse(x.endsAt)>Date.parse(x.startsAt),{message:'endsAt must follow startsAt'});
export const uploadInput=z.object({mimeType:z.enum(['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']),bytes:z.number().int().positive().max(100*1024*1024)}).strict();
