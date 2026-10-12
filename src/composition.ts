export type PanelFrame = { x: number; y: number; w: number; h: number };
type ObjectTransform = { x: number; y: number; scale: number; rotation: number };
type Objects = Record<'background' | 'silhouette' | 'subject', ObjectTransform>;

export function framesFor(layout: string, split: number, W: number, H: number, swapped = false) {
  if (layout === 'overlay' || layout === 'echo')
    return { photo: { x: 0, y: 0, w: W, h: H }, solid: { x: 0, y: 0, w: W, h: H } };
  const ratio = split / 100;
  return layout === 'vertical'
    ? { photo: { x: 0, y: swapped ? H * (1-ratio) : 0, w: W, h: H * ratio },
        solid: { x: 0, y: swapped ? 0 : H * ratio, w: W, h: H * (1-ratio) } }
    : { photo: { x: swapped ? W * (1-ratio) : 0, y: 0, w: W * ratio, h: H },
        solid: { x: swapped ? 0 : W * ratio, y: 0, w: W * (1-ratio), h: H } };
}

/** Translate each whole group to its new panel, without mirroring pixels,
 * changing object scale/rotation or disturbing local offsets and layer order. */
export function swapPanelObjects(objects: Objects, layout: string, split: number, size: {w: number; h: number}, swapped: boolean): Objects {
  const before = framesFor(layout, split, size.w, size.h, swapped);
  const after = framesFor(layout, split, size.w, size.h, !swapped);
  const move = (transform: ObjectTransform, from: PanelFrame, to: PanelFrame): ObjectTransform => ({
    ...transform,
    x: Math.round((transform.x + (to.x - from.x) / size.w) * 1e12) / 1e12,
    y: Math.round((transform.y + (to.y - from.y) / size.h) * 1e12) / 1e12,
  });
  return {background: move(objects.background, before.photo, after.photo),
    silhouette: move(objects.silhouette, before.photo, after.photo), subject: move(objects.subject, before.solid, after.solid)};
}
