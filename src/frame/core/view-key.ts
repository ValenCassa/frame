/** Opaque brand for a view's masked cache reference.
 *  Components can only consume one via `useView`. */
export interface ViewKey<_V> {
  readonly __frame_key: true;
  readonly __ref: string;
}
