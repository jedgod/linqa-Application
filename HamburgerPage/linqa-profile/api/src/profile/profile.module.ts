import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

// Add ProfileModule to the `imports` array of your AppModule.
// If you already have a PrismaModule that exports PrismaService,
// import that module here instead of listing PrismaService as a provider.
@Module({
  controllers: [ProfileController],
  providers: [ProfileService, PrismaService],
})
export class ProfileModule {}
