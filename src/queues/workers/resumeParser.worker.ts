import { Worker } from 'bullmq';
import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { ResumeParserService } from '../../services/ai/resumeParser.service';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

export const resumeParserWorker = new Worker(
  'resume-parser',
  async (job) => {
    const { resumeId, userId, cloudinaryUrl, localFilePath } = job.data;
    logger.info(`Parsing resume ${resumeId}`);

    await job.updateProgress(10);

    await prisma.resume.update({
      where: { id: resumeId },
      data: { status: 'PROCESSING' },
    });

    try {
      // Download file if local path not available
      let fileBuffer: Buffer;
      if (localFilePath && fs.existsSync(localFilePath)) {
        fileBuffer = fs.readFileSync(localFilePath);
        fs.unlinkSync(localFilePath); // Clean up the temp file
      } else {
        const response = await axios.get(cloudinaryUrl, { responseType: 'arraybuffer' });
        fileBuffer = Buffer.from(response.data);
      }

      await job.updateProgress(30);

      // Fetch user profile to get target role for better analysis
      const userProfile = await prisma.userProfile.findUnique({ where: { userId } });
      const targetRole = userProfile?.targetRole || 'SOFTWARE_ENGINEER';

      // Extract text using AI service
      const parser = new ResumeParserService();
      const parsedData = await parser.parse(fileBuffer, cloudinaryUrl, targetRole);

      await job.updateProgress(70);

      // Save parsed data + extracted skills
      await prisma.$transaction(async (tx) => {
        await tx.resume.update({
          where: { id: resumeId },
          data: {
            parsedData: parsedData as any,
            status: 'COMPLETED',
          },
        });

        // Delete old skills
        await tx.resumeSkill.deleteMany({ where: { resumeId } });

        // Insert new skills
        if (parsedData.skills.length > 0) {
          await tx.resumeSkill.createMany({
            data: parsedData.skills.map((skill) => ({
              resumeId,
              name: skill.name,
              category: skill.category as any,
              proficiencyLevel: skill.proficiencyLevel as any,
              source: 'RESUME',
              confidence: skill.confidence,
            })),
          });
        }

        // Activity log
        await tx.activityLog.create({
          data: {
            userId,
            type: 'RESUME_PARSED',
            title: 'Resume Analyzed',
            description: `Extracted ${parsedData.skills.length} skills from your resume`,
          },
        });
      });

      await job.updateProgress(100);
      logger.info(`Resume ${resumeId} parsed successfully`);

      return { resumeId, skillsExtracted: parsedData.skills.length };
    } catch (error) {
      await prisma.resume.update({
        where: { id: resumeId },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 3,
  },
);

resumeParserWorker.on('completed', (job) => logger.info(`Resume parser job ${job.id} completed`));
resumeParserWorker.on('failed', (job, err) => logger.error(`Resume parser job ${job?.id} failed`, err));
