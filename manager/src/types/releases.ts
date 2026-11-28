export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export interface UpgradeProgress {
  step: "downloading" | "verifying" | "upgrading" | "done" | "error";
  message: string;
  percent: number;
}
