const packageIdPattern = /PKG-[A-Z0-9-]+/i;

export const extractPackageId = (question: string) =>
  question.match(packageIdPattern)?.[0]?.toUpperCase();
