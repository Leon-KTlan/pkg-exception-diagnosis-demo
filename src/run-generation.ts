export const createRunGeneration = () => {
  let current = 0;

  return {
    next: () => {
      current += 1;
      return current;
    },
    isCurrent: (generation: number) => generation === current,
  };
};
