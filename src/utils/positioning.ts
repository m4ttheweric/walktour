
import { Coords, getElementCoords, dist, getElementDims, Dims, getCombinedData } from "./dom";
import { getViewportCenter, addAppropriateOffset, applyCenterOffset, centerViewportAroundElements } from "./offset";
import { getViewportDims, getViewportScrollEnd, getScrolledViewportPosition, getViewportScrollStart, isElementInView } from "./viewport";

export enum CardinalOrientation {
  EAST = 'east',
  SOUTH = 'south',
  WEST = 'west',
  NORTH = 'north',
  CENTER = 'center',
  EASTNORTH = 'east-north',
  EASTSOUTH = 'east-south',
  SOUTHEAST = 'south-east',
  SOUTHWEST = 'south-west',
  WESTSOUTH = 'west-south',
  WESTNORTH = 'west-north',
  NORTHWEST = 'north-west',
  NORTHEAST = 'north-east'
}

export interface OrientationCoords {
  orientation: CardinalOrientation;
  coords: Coords;
}

interface GetTooltipPositionArgs {
  target: HTMLElement;
  tooltip: HTMLElement;
  padding: number;
  tooltipSeparation: number;
  tourRoot: Element;
  orientationPreferences?: CardinalOrientation[];
  getPositionFromCandidates?: (candidates: OrientationCoords[]) => Coords;
  scrollDisabled?: boolean;
}

function getTooltipPositionCandidates(target: HTMLElement, tooltip: HTMLElement, padding: number, tooltipDistance: number, includeAllPositions?: boolean): OrientationCoords[] {
  if (!target || !tooltip) {
    return;
  }

  const tooltipDims: Dims = getElementDims(tooltip);
  const targetCoords: Coords = getElementCoords(target);
  const targetDims: Dims = getElementDims(target);
  const centerX: number = targetCoords.x - ((tooltipDims.width - targetDims.width) / 2);
  const centerY: number = targetCoords.y - ((tooltipDims.height - targetDims.height) / 2);
  const eastOffset: number = targetCoords.x + targetDims.width + padding + tooltipDistance;
  const southOffset: number = targetCoords.y + targetDims.height + padding + tooltipDistance;
  const westOffset: number = targetCoords.x - tooltipDims.width - padding - tooltipDistance;
  const northOffset: number = targetCoords.y - tooltipDims.height - padding - tooltipDistance;

  const east: Coords = { x: eastOffset, y: centerY }
  const south: Coords = { x: centerX, y: southOffset }
  const west: Coords = { x: westOffset, y: centerY };
  const north: Coords = { x: centerX, y: northOffset };
  const center: Coords = applyCenterOffset(targetCoords, targetDims, tooltipDims);

  const standardPositions = [
    { orientation: CardinalOrientation.EAST, coords: east },
    { orientation: CardinalOrientation.SOUTH, coords: south },
    { orientation: CardinalOrientation.WEST, coords: west },
    { orientation: CardinalOrientation.NORTH, coords: north },
  ];

  let additionalPositions: OrientationCoords[];
  if (includeAllPositions) {
    const eastAlign: number = targetCoords.x - (tooltipDims.width - targetDims.width) + padding;
    const southAlign: number = targetCoords.y - (tooltipDims.height - targetDims.height) + padding;
    const westAlign: number = targetCoords.x - padding;
    const northAlign: number = targetCoords.y - padding;

    const eastNorth: Coords = { x: eastOffset, y: northAlign }
    const eastSouth: Coords = { x: eastOffset, y: southAlign }
    const southEast: Coords = { x: eastAlign, y: southOffset }
    const southWest: Coords = { x: westAlign, y: southOffset }
    const westSouth: Coords = { x: westOffset, y: southAlign }
    const westNorth: Coords = { x: westOffset, y: northAlign }
    const northWest: Coords = { x: westAlign, y: northOffset }
    const northEast: Coords = { x: eastAlign, y: northOffset }

    additionalPositions = [
      { orientation: CardinalOrientation.EASTNORTH, coords: eastNorth },
      { orientation: CardinalOrientation.EASTSOUTH, coords: eastSouth },
      { orientation: CardinalOrientation.SOUTHEAST, coords: southEast },
      { orientation: CardinalOrientation.SOUTHWEST, coords: southWest },
      { orientation: CardinalOrientation.WESTSOUTH, coords: westSouth },
      { orientation: CardinalOrientation.WESTNORTH, coords: westNorth },
      { orientation: CardinalOrientation.NORTHWEST, coords: northWest },
      { orientation: CardinalOrientation.NORTHEAST, coords: northEast }
    ]
  }

  return [
    ...standardPositions,
    ...additionalPositions,
    { orientation: CardinalOrientation.CENTER, coords: center }
  ]
}

// simple reducer who selects for coordinates closest to the current center of the viewport
function getCenterReducer(root: Element, tooltip: HTMLElement, target: HTMLElement, predictViewport?: boolean):
  ((acc: Coords, cur: OrientationCoords, ind: number, arr: OrientationCoords[]) => Coords) {
  const currentCenter: Coords = getViewportCenter(root, tooltip);

  // store the center of the predicted viewport location with the tooltip at acc
  // to have a meaningful distance comparison
  let accCenter: Coords = currentCenter;

  const getCenter = (coords: Coords) => {
    if (predictViewport && (!isElementInView(root, target) || !isElementInView(root, tooltip, coords, true))) {
      return getViewportCenter(root, tooltip, getScrolledViewportPosition(root, centerViewportAroundElements(root, tooltip, target, coords)));
    } else {
      return currentCenter;
    }
  }

  return (acc: Coords, cur: OrientationCoords, ind: number, arr: OrientationCoords[]): Coords => {
    if (cur.orientation === CardinalOrientation.CENTER) { //ignore centered coords since those will always be closest to the center
      if (ind === arr.length - 1 && acc === undefined) { //unless  we're at the end and we still haven't picked a coord
        return cur.coords;
      } else {
        return acc;
      }
    } else if (acc === undefined) {
      accCenter = getCenter(cur.coords);
      return cur.coords;
    } else {
      const center: Coords = getCenter(cur.coords);

      if (dist(center, cur.coords) > dist(accCenter, acc)) {
        return acc;
      } else {
        accCenter = center;
        return cur.coords;
      }
    }
  }
}

// complex candidate reducer function that tries to place the tooltip as close to the center of the 
// screen as possible, even after the screen has scrolled to a particular location.
function chooseBestTooltipPosition(preferredCandidates: OrientationCoords[], root: Element, tooltip: HTMLElement, target: HTMLElement, scrollDisabled: boolean): Coords {
  if (preferredCandidates.length === 1) {
    //if there's only a single pref candidate, use that
    return preferredCandidates[0].coords;
  } else if (scrollDisabled) {
    // if scrolling is disabled, there's not much we can do except use the naive center reducer
    return preferredCandidates.reduce(getCenterReducer(root, tooltip, target, false), undefined);
  } else {
    // scrolling is allowed, which means we have to figure out:
    // 1: where the window might be
    // 2: if both elements fit on screen at the same time
    // 3: if (2), what coordinates fulfil that possibility
    // 4: if (2), which of them does (3) the _best_

    // steps to accomplish:
    // filter candidates (c0) down to their viable options (c1)
    // filterInBoundsCandidates(root, tooltip, c0)
    // filter (c1) down to those that allow  tooltip/target on screen at same time (c2)
    // filterCompatibleCandidates(root, tooltip, target, c1)
    // reduce c2 based on center proximity. "center" refers not to the current center but the
    // c2.reduce(centerReducer);
    // coordinates of the center once the viewport has scrolled


    const viewportDims: Dims = getViewportDims(root);
    const viewportScrollStart: Coords = getViewportScrollStart(root);
    const viewportScrollEnd: Coords = getViewportScrollEnd(root);
    const tooltipDims: Dims = getElementDims(tooltip);
    const targetDims: Dims = getElementDims(target);
    const targetCoords: Coords = getElementCoords(target);


    const inbounds = preferredCandidates.filter(getInBoundsFilter(tooltipDims, viewportScrollStart, viewportScrollEnd));
    console.log('inbounds', inbounds);
    const compatible = inbounds.filter(getCompatibleArrangementFilter(tooltipDims, targetCoords, targetDims, viewportDims));
    console.log("compatible", compatible);
    const reduced = compatible.reduce(getCenterReducer(root, tooltip, target, true), undefined);
    console.log('reduced', reduced);
    return reduced;
    // return preferredCandidates.
    //   filter(getInBoundsFilter(tooltipDims, viewportStart, viewportScrollEnd)).
    //   filter(getCompatibleArrangementFilter(tooltipDims, targetCoords, targetDims, viewportDims)).
    //   reduce(getCenterReducer(root, tooltip, target), undefined);
  }
}

// filter out any positions which would have the tooltip be out of the bounds of the root container 
// (i.e. in a position) that the viewport can't "reach"/scroll to
function getInBoundsFilter(tooltipDims: Dims, viewportScrollStart: Coords, viewportScrollEnd: Coords): (oc: OrientationCoords) => boolean {
  return (oc: OrientationCoords): boolean => {
    const coords: Coords = oc.coords;
    return !(coords.x < viewportScrollStart.x || coords.y < viewportScrollStart.y ||
      (coords.x + tooltipDims.width) > viewportScrollEnd.x || (coords.y + tooltipDims.height) > viewportScrollEnd.y)
  }

}

// filters out any positions which would cause the target/tooltip to not fit within the viewport
function getCompatibleArrangementFilter(tooltipDims: Dims, targetCoords: Coords, targetDims: Dims, viewportDims: Dims): (oc: OrientationCoords) => boolean {
  return (oc: OrientationCoords): boolean => {
    const coords: Coords = oc.coords;
    // we only care about the resultant dims but the input coords are critical here
    const { dims: combinedDims } = getCombinedData(coords, tooltipDims, targetCoords, targetDims);

    return combinedDims.width <= viewportDims.width && combinedDims.height <= viewportDims.height
  }


}

function getPreferredCandidates(candidates: OrientationCoords[], orientationPreferences?: CardinalOrientation[]): OrientationCoords[] {
  if (!orientationPreferences || orientationPreferences.length === 0) {
    console.log('no prefs, use all candidates')
    return candidates;
  } else if (orientationPreferences.length === 1) {
    console.log('only one pref, use that')
    const specifiedCandidate = candidates.find((oc: OrientationCoords) => oc.orientation === orientationPreferences[0])
    if (specifiedCandidate) {
      return [specifiedCandidate];
    } else {
      console.log('specified orientation not found for some reason. Defaulting to automatic behavior.');
      return candidates;
    }
  } else {
    const preferenceFilter = (cc: OrientationCoords) => orientationPreferences.indexOf(cc.orientation) !== -1;
    const returns = candidates.filter(preferenceFilter);
    console.log('preferred', returns)
    return returns;
  }
}

export function getTooltipPosition(args: GetTooltipPositionArgs): Coords {
  const { target, tooltip, padding, tooltipSeparation, orientationPreferences, getPositionFromCandidates, tourRoot, scrollDisabled } = args;
  const defaultPosition: Coords = addAppropriateOffset(tourRoot, getViewportCenter(tourRoot, tooltip));

  if (!tooltip || !tourRoot) {
    return;
  } else if (!target) {
    return defaultPosition;
  }


  console.log('target', target);
  const candidates: OrientationCoords[] = getTooltipPositionCandidates(target, tooltip, padding, tooltipSeparation, true);
  console.log('candidates', candidates);
  const choosePosition = getPositionFromCandidates || ((cans: OrientationCoords[]) => chooseBestTooltipPosition(cans, tourRoot, tooltip, target, scrollDisabled ));

  const rawPosition: Coords = choosePosition(getPreferredCandidates(candidates, orientationPreferences)); //position relative to current viewport

  if (!rawPosition) {
    return defaultPosition;
  }

  return addAppropriateOffset(tourRoot, rawPosition);
}

export function getTargetPosition(root: Element, target: HTMLElement): Coords {
  return addAppropriateOffset(root, getElementCoords(target));
}

