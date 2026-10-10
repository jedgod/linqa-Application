import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AdvancedDiscoveryService } from "../services/countrylinqa/advanced/advancedDiscoveryService.js";
import { SavedSearchRepository } from "../services/countrylinqa/advanced/savedSearchRepository.js";

export const countryLinqaAdvancedRouter=Router();
const discovery=new AdvancedDiscoveryService();
const saved=new SavedSearchRepository();

countryLinqaAdvancedRouter.post("/people/search",requireAuth,async(req,res,next)=>{
  try {
    const result=await discovery.people({
      userId:req.auth!.userId,
      filters:req.body?.filters ?? {},
      limit:Number(req.body?.limit ?? 30)
    });
    res.json(result);
  } catch(e){ next(e); }
});

countryLinqaAdvancedRouter.get("/saved-searches",requireAuth,async(req,res,next)=>{
  try { res.json(await saved.list(req.auth!.userId)); }
  catch(e){ next(e); }
});

countryLinqaAdvancedRouter.post("/saved-searches",requireAuth,async(req,res,next)=>{
  try { res.status(201).json(await saved.create(req.auth!.userId,req.body)); }
  catch(e){ next(e); }
});

countryLinqaAdvancedRouter.delete("/saved-searches/:id",requireAuth,async(req,res,next)=>{
  try {
    await saved.remove(req.auth!.userId,req.params.id);
    res.status(204).end();
  } catch(e){ next(e); }
});
