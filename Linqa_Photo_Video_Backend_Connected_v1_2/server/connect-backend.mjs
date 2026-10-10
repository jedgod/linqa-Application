import {PostgresMediaRepository} from './postgres-repository.mjs';
import {PrivateBlobStore} from './blob-store.mjs';
import {MediaService} from './media-service.mjs';
import {mediaRouter} from './router.mjs';
/** Mount into the existing server; no second auth system or chat history. */
export function connectPhotoVideoBackend({app,express,pool,privateBlobDirectory,
 authenticate,requireBoundDevice,uploadRateLimit,authorizeChatMedia,
 reserveQuotaAndVerifyMembership,blobStore}) {
 for(const [name,fn] of Object.entries({authenticate,requireBoundDevice,uploadRateLimit,authorizeChatMedia,reserveQuotaAndVerifyMembership})) {
  if(typeof fn!=='function')throw new Error(`MEDIA_CONNECTION_REQUIRED:${name}`);
 }
 if(!pool||!app||!express)throw new Error('MEDIA_SERVER_DEPENDENCY_REQUIRED');
 if(!blobStore&&!privateBlobDirectory)throw new Error('PRIVATE_MEDIA_STORAGE_REQUIRED');
 const repository=new PostgresMediaRepository(pool,{reserveQuotaAndVerifyMembership});
 const service=new MediaService({repository,blobs:blobStore??new PrivateBlobStore(privateBlobDirectory),authorize:authorizeChatMedia});
 app.use(mediaRouter({express,service,authenticate,requireBoundDevice,uploadRateLimit}));
 return {service,repository};
}
