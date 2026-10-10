import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { PeopleDiscoveryService } from "../services/countrylinqa/peopleDiscovery.js";
import { CountryContentDiscoveryService } from "../services/countrylinqa/contentDiscovery.js";

export const countryLinqaDiscoveryEngineRouter=Router();
const people=new PeopleDiscoveryService();
const content=new CountryContentDiscoveryService();

countryLinqaDiscoveryEngineRouter.get("/people",requireAuth,async(req,res,next)=>{
  try {
    res.json(await people.list(
      req.auth!.userId,
      Number(req.query.limit ?? 30),
      typeof req.query.cursor==="string" ? req.query.cursor : undefined
    ));
  } catch(e){ next(e); }
});

countryLinqaDiscoveryEngineRouter.get("/posts",requireAuth,async(req,res,next)=>{
  try { res.json((await content.posts(req.auth!.userId)).rows); }
  catch(e){ next(e); }
});

countryLinqaDiscoveryEngineRouter.get("/events",requireAuth,async(req,res,next)=>{
  try { res.json((await content.events(req.auth!.userId)).rows); }
  catch(e){ next(e); }
});

countryLinqaDiscoveryEngineRouter.get("/businesses",requireAuth,async(req,res,next)=>{
  try { res.json((await content.businesses(req.auth!.userId)).rows); }
  catch(e){ next(e); }
});

countryLinqaDiscoveryEngineRouter.get("/communities",requireAuth,async(req,res,next)=>{
  try { res.json((await content.communities(req.auth!.userId)).rows); }
  catch(e){ next(e); }
});
