/**
 * The data layer: everything that touches the vault.
 *
 * The repository reads tasks from `MetadataCache` and writes them back through
 * `FileManager.processFrontMatter`, keeping an in-memory store in sync with the
 * vault. `frontmatter.ts` holds the pure mapping between frontmatter and the
 * domain {@link Task}.
 */

export * from "./frontmatter";
export * from "./task-repository";
