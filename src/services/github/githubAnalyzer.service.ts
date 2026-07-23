import axios, { AxiosError } from 'axios';
import { logger } from '../../lib/logger';
import type { GitHubRepo, LanguageStat } from '../../types';

const GITHUB_API = 'https://api.github.com';

export class GitHubAnalyzerService {
  private getHeaders() {
    return process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {};
  }

  private async fetchWithRetry(url: string, config: any = {}) {
    try {
      return await axios.get(url, { ...config, headers: { ...this.getHeaders(), ...config.headers } });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403 && error.response.headers['x-ratelimit-remaining'] === '0') {
        logger.warn('GitHub API rate limit exceeded');
        throw new Error('GitHub API rate limit exceeded');
      }
      throw error;
    }
  }

  async analyze(username: string, onProgress?: (n: number) => void): Promise<any> {
    const report = (n: number) => onProgress?.(n);

    report(10);

    // 1. Fetch user profile
    const userRes = await this.fetchWithRetry(`${GITHUB_API}/users/${username}`);
    const user = userRes.data;

    report(20);

    // 2. Fetch repositories with Pagination
    let repos: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const reposRes = await this.fetchWithRetry(`${GITHUB_API}/users/${username}/repos`, {
        params: { sort: 'pushed', per_page: 100, page, type: 'owner' },
      });
      repos = repos.concat(reposRes.data);
      if (reposRes.data.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
      if (page > 3) hasMore = false; // Cap at 300 repos to prevent infinite/long loops
    }

    report(40);

    // 3. Analyze top repos (limit to 15 non-forks to avoid rate limits on detailed fetches)
    const languageMap = new Map<string, number>();
    const analyzedRepos: GitHubRepo[] = [];
    const topRepos = repos.filter((r) => !r.fork).slice(0, 15);
    let totalCommits = 0;

    for (const [index, repo] of topRepos.entries()) {
      try {
        // Fetch Languages
        const langRes = await this.fetchWithRetry(repo.languages_url);
        const langs = langRes.data as Record<string, number>;

        for (const [lang, bytes] of Object.entries(langs)) {
          languageMap.set(lang, (languageMap.get(lang) || 0) + bytes);
        }

        // Fetch Commits count
        let commitCount = 0;
        try {
          const commitsRes = await this.fetchWithRetry(`${GITHUB_API}/repos/${username}/${repo.name}/commits`, {
            params: { author: username, per_page: 1 },
          });
          
          const linkHeader = commitsRes.headers['link'];
          if (linkHeader) {
            const match = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (match) commitCount = parseInt(match[1], 10);
          } else if (commitsRes.data && commitsRes.data.length > 0) {
            commitCount = 1; // only fetched 1 per page, no link means 1 total if array length is 1
          }
        } catch (e) {
          // ignore if repository is empty (409 Conflict typically for empty repos)
        }
        totalCommits += commitCount;

        // Fetch README
        let readme = '';
        try {
          const readmeRes = await this.fetchWithRetry(`${GITHUB_API}/repos/${username}/${repo.name}/readme`, {
            headers: { Accept: 'application/vnd.github.v3.raw' },
          });
          readme = typeof readmeRes.data === 'string' ? readmeRes.data.substring(0, 2000) : ''; // truncate
        } catch (e) {
          // No README exists
        }

        analyzedRepos.push({
          name: repo.name,
          description: repo.description,
          url: repo.html_url,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          languages: Object.keys(langs),
          topics: repo.topics || [],
          isForked: repo.fork,
          lastCommitDate: repo.pushed_at,
          commitCount,
          readme,
        });

        report(40 + Math.floor(((index + 1) / topRepos.length) * 40));
      } catch (error) {
        logger.error(`Failed to analyze repo ${repo.name}`);
      }
    }

    report(80);

    // Calculate language percentages
    const totalBytes = Array.from(languageMap.values()).reduce((a, b) => a + b, 0);
    const topLanguages: LanguageStat[] = Array.from(languageMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([language, bytes]) => ({
        language,
        percentage: Math.round((bytes / totalBytes) * 100),
        bytes,
      }));

    report(95);

    return {
      avatarUrl: user.avatar_url,
      bio: user.bio,
      publicRepos: user.public_repos,
      followers: user.followers,
      following: user.following,
      topLanguages,
      repositories: analyzedRepos,
      contributions: totalCommits, // Approximation based on analyzed repos
    };
  }
}
