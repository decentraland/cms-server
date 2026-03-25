module.exports = {
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", {tsconfig: "test/tsconfig.json"}]
  },
  moduleFileExtensions: ["ts", "js"],
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "src/**/*.js", "!src/migrations/**", "!src/types/**", "!src/types.ts", "!src/index.ts"],
  testMatch: ["**/*.spec.(ts)"],
  testEnvironment: "node",
}
