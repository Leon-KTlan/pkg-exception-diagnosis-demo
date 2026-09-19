const packageIdPattern = /(?:^|[^A-Z0-9_-])(PKG-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?![A-Z0-9_-])/gi;

export const extractPackageIds = (question: string) => {
  const packageIds = new Set<string>();
  for (const match of question.matchAll(packageIdPattern)) {
    packageIds.add(match[1].toUpperCase());
  }
  return [...packageIds];
};
