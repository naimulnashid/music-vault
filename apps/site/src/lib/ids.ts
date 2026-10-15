/** Element ids unique within a build, and the same on every build. */
let count = 0;
export const nextId = (prefix: string) => `${prefix}-${++count}`;
