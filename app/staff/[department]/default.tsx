/** The children slot, which is now always empty: Tools and Training both live in
 *  @tools / @training, and the bare /staff/<department> never reaches rendering
 *  because proxy.ts redirects it to /tools.
 *
 *  Keep it that way. A redirect (or anything stateful) here is retained by the
 *  router across soft navigations and re-runs on every one of them. */
export default function DepartmentDefault() {
  return null;
}
