import {Router} from 'express';
export function vaultHealthRoutes(deps:{db:any}){const r=Router();r.get('/health/live',(_q,res)=>res.json({ok:true,service:'vault'}));r.get('/health/ready',async(_q,res)=>{try{await deps.db.query('SELECT 1');res.json({ok:true})}catch{res.status(503).json({ok:false})}});return r}
