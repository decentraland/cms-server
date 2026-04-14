module.exports = {
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", {tsconfig: "test/tsconfig.json"}]
  },
  moduleFileExtensions: ["ts", "js"],
  coverageDirectory: "coverage",
  testMatch: ["**/test/integration/**/*.spec.(ts)"],
  testEnvironment: "node",
  resetMocks: true,
  testTimeout: 60000,
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
}
