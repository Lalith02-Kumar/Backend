import axios from 'axios';
import { logger } from '../../lib/logger';
import type { CodingStats } from '../../types';

export class CodingProfileFetcherService {
  async fetchStats(platform: string, username: string): Promise<CodingStats> {
    logger.info(`Fetching ${platform} stats for ${username}`);

    switch (platform) {
      case 'LEETCODE':
        return this.fetchLeetCode(username);
      case 'CODEFORCES':
        return this.fetchCodeforces(username);
      case 'CODECHEF':
        return this.fetchCodeChef(username);
      case 'GFG':
        return this.fetchGFG(username);
      case 'HACKERRANK':
        return this.fetchHackerRank(username);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  private async fetchLeetCode(username: string): Promise<CodingStats> {
    const query = `
      query userPublicProfile($userSlug: String!) {
        matchedUser(username: $userSlug) {
          submitStats {
            acSubmissionNum {
              difficulty
              count
            }
          }
          profile {
            ranking
          }
          badges { name }
        }
      }
    `;

    const res = await axios.post(
      'https://leetcode.com/graphql',
      { query, variables: { userSlug: username } },
      { headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' }, timeout: 10000 },
    );

    const user = res.data?.data?.matchedUser;
    if (!user) throw new Error('LeetCode user not found');

    const stats = user.submitStats?.acSubmissionNum || [];
    const easy = stats.find((s: any) => s.difficulty === 'Easy')?.count || 0;
    const medium = stats.find((s: any) => s.difficulty === 'Medium')?.count || 0;
    const hard = stats.find((s: any) => s.difficulty === 'Hard')?.count || 0;

    return {
      totalSolved: easy + medium + hard,
      easySolved: easy,
      mediumSolved: medium,
      hardSolved: hard,
      rank: user.profile?.ranking?.toString(),
      badges: user.badges?.map((b: any) => b.name) || [],
    };
  }

  private async fetchCodeforces(username: string): Promise<CodingStats> {
    const res = await axios.get(`https://codeforces.com/api/user.info?handles=${username}`, {
      timeout: 10000,
    });

    if (res.data?.status !== 'OK') throw new Error('Codeforces user not found');
    const user = res.data.result[0];

    return {
      rating: user.rating,
      maxRating: user.maxRating,
      rank: user.rank,
      contestsParticipated: undefined,
    };
  }

  private async fetchCodeChef(username: string): Promise<CodingStats> {
    // CodeChef doesn't have a public API, use unofficial endpoint
    try {
      const res = await axios.get(`https://www.codechef.com/users/${username}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      // Parse rating from HTML (simplified)
      const ratingMatch = res.data.match(/Current Rating:<\/strong>\s*<strong[^>]*>(\d+)/);
      const rating = ratingMatch ? parseInt(ratingMatch[1]) : undefined;

      return { rating, rank: undefined };
    } catch {
      return { rating: undefined };
    }
  }

  private async fetchGFG(username: string): Promise<CodingStats> {
    try {
      const res = await axios.get(`https://auth.geeksforgeeks.org/user/${username}/practice/`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      // Parse stats from page
      const solvedMatch = res.data.match(/Problems Solved<\/span>\s*<span[^>]*>(\d+)/);
      const solved = solvedMatch ? parseInt(solvedMatch[1]) : undefined;

      return { totalSolved: solved };
    } catch {
      return {};
    }
  }

  private async fetchHackerRank(username: string): Promise<CodingStats> {
    try {
      const res = await axios.get(`https://www.hackerrank.com/rest/hackers/${username}/scores_elo`, {
        timeout: 10000,
      });

      const badges = res.data?.badges?.map((b: any) => `${b.name} (${b.stars}★)`) || [];
      return { badges };
    } catch {
      return {};
    }
  }
}
