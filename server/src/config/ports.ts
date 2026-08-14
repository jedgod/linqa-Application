export interface LocalPortResolution {
  apiPort: number;
  databasePort: number;
}

export function resolveLocalPorts(env: NodeJS.ProcessEnv): LocalPortResolution {
  return {
    apiPort: Number(env.PORT ?? env.LINQA_API_PORT ?? 8080),
    databasePort: Number(env.PGPORT ?? env.LINQA_DATABASE_PORT ?? 5432)
  };
}

/*
Windows local-development notes:

- A native PostgreSQL installation may already use port 5432.
  Override Docker/local development only:
      LINQA_DATABASE_PORT=55432

- Windows may reserve port 8080.
  Override local API startup only:
      LINQA_API_PORT=8088

The shipped defaults remain 5432 and 8080.
*/
