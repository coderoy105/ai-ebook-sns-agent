import "workflow";

declare module "workflow" {
  /** Internal helper only passes validated duration strings such as 15s, 2m, 1h, and 24h. */
  export function sleep(duration: string): Promise<void>;
}
