/**
 * Test Data Helper
 * Provides access to seeded test data IDs
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface TestData {
  projects: {
    project1: { id: string; apiKey: string };
    project2: { id: string; apiKey: string };
  };
  bugReports: {
    loginCrash: string;
    dashboardSlow: string;
    searchFilter: string;
    typoFooter: string;
    uploadIssue: string;
    mobileMenu: string;
    emailValidation: string;
    passwordReset: string;
    profilePicture: string;
    securityVuln: string;
    apiTimeout: string;
    cacheIssue: string;
    memoryLeak: string;
  };
}

let testData: TestData | null = null;

export function getTestData(): TestData {
  if (testData) {
    return testData;
  }

  const testDataPath = join(process.cwd(), 'test-data.json');

  if (!existsSync(testDataPath)) {
    throw new Error(`Test data file not found at ${testDataPath}. Run global setup first.`);
  }

  const content = readFileSync(testDataPath, 'utf-8');
  testData = JSON.parse(content);

  return testData!;
}

export function getProject1() {
  return getTestData().projects.project1;
}

export function getProject2() {
  return getTestData().projects.project2;
}

export function getBugReport(key: keyof TestData['bugReports']): string {
  return getTestData().bugReports[key];
}

export function getAllBugReportIds(): string[] {
  const data = getTestData();
  return Object.values(data.bugReports);
}
