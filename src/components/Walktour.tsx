import * as React from 'react';
import { Coords, getTooltipPosition, CardinalOrientation, getNearestScrollAncestor, OrientationCoords, isElementInView, scrollToElement, getTargetPosition, dist } from '../positioning'
import { Mask } from './Mask';
import { Tooltip } from './Tooltip';
import * as ReactDOM from 'react-dom';

export interface WalktourLogic {
  next: () => void;
  prev: () => void;
  close: () => void;
  goToStep: (stepNumber: number) => void;
  stepContent: Step;
  stepIndex: number;
  allSteps: Step[];
}

export interface WalktourOptions {
  disableMaskInteraction?: boolean;
  disableCloseOnClick?: boolean;
  orientationPreferences?: CardinalOrientation[];
  maskPadding?: number;
  tooltipSeparation?: number;
  tooltipWidth?: number;
  transition?: string;
  customTitleRenderer?: (title?: string, tourLogic?: WalktourLogic) => JSX.Element;
  customDescriptionRenderer?: (description: string, tourLogic?: WalktourLogic) => JSX.Element;
  customFooterRenderer?: (tourLogic?: WalktourLogic) => JSX.Element;
  customTooltipRenderer?: (tourLogic?: WalktourLogic) => JSX.Element;
  customNextFunc?: (tourLogic: WalktourLogic) => void;
  customPrevFunc?: (tourLogic: WalktourLogic) => void;
  prevLabel?: string;
  nextLabel?: string;
  closeLabel?: string;
  disableNext?: boolean;
  disablePrev?: boolean;
  disableClose?: boolean;
  disableAutoScroll?: boolean;
  positionCandidateReducer?: (acc: Coords, cur: OrientationCoords, ind: number, arr: OrientationCoords[]) => Coords;
  movingTarget?: boolean;
  updateInterval?: number;
  renderTolerance?: number;
}

export interface Step extends WalktourOptions {
  selector: string;
  title?: string;
  description: string;
}

export interface WalktourProps extends WalktourOptions {
  steps: Step[];
  initialStepIndex?: number;
  zIndex?: number;
  rootSelector?: string;
  identifier?: string;
}

const walktourDefaultProps: Partial<WalktourProps> = {
  tooltipWidth: 250,
  maskPadding: 5,
  tooltipSeparation: 10,
  transition: 'top 200ms ease, left 200ms ease',
  disableMaskInteraction: false,
  disableCloseOnClick: false,
  zIndex: 9999,
  renderTolerance: 2
}

const basePortalString: string = 'walktour-portal';
const baseTooltipContainerString: string = 'walktour-tooltip-container';

export const Walktour = (props: WalktourProps) => {

  const {
    steps,
    initialStepIndex
  } = props;

  const [isVisible, setVisible] = React.useState<boolean>(true);
  const [target, setTarget] = React.useState<HTMLElement>(undefined);
  const [tooltipPosition, setTooltipPosition] = React.useState<Coords>(undefined);
  const [currentStepIndex, setCurrentStepIndex] = React.useState<number>(initialStepIndex || 0);
  const tourRoot = React.useRef<Element>(undefined);

  const targetPosition = React.useRef<Coords>(undefined);
  const watcherId = React.useRef<number>(undefined);

  const currentStepContent: Step = steps[currentStepIndex];
  const {
    maskPadding,
    disableMaskInteraction,
    disableCloseOnClick,
    tooltipSeparation,
    tooltipWidth,
    transition,
    orientationPreferences,
    customTooltipRenderer,
    zIndex,
    rootSelector,
    customNextFunc,
    customPrevFunc,
    disableClose,
    disableNext,
    disablePrev,
    disableAutoScroll,
    identifier,
    positionCandidateReducer,
    movingTarget,
    renderTolerance,
    updateInterval
  } = {
    ...walktourDefaultProps,
    ...props,
    ...currentStepContent
  };

  // after first render(s), set the tour root and initial position of target/tooltip
  React.useEffect(() => {
    let root: Element;
    if (rootSelector) {
      root = document.querySelector(rootSelector);
    }
    if (!root) {
      root = getNearestScrollAncestor(document.getElementById(getIdString(basePortalString, identifier)));
    }
    tourRoot.current = root;

    return () => window.clearInterval(watcherId.current); //clear the target watcher on unmount
  }, []);


  // update tour when step changes
  React.useEffect(() => {
    updateTour();
  }, [currentStepIndex])

  // add target watcher when the target element is updated 
  React.useEffect(() => {
    if (watcherId.current) {
      window.clearInterval(watcherId.current);
    }

    if (!target || !movingTarget) {
      return;
    }

    watcherId.current = window.setInterval(() => {
      if (shouldUpdate(tourRoot.current, target, targetPosition.current, renderTolerance)) {
        updateTour();
      }
    }, updateInterval)

  }, [target])

  // update tooltip and target position in state
  const updateTour = () => {
    const root = tourRoot.current;
    if (!root) {
      return;
    }

    const tooltipContainer: HTMLElement = document.getElementById(getIdString(baseTooltipContainerString, identifier));
    const target: HTMLElement = document.querySelector(currentStepContent.selector);

    if (!tooltipContainer) {
      setTarget(null);
      setTooltipPosition(null);
      return;
    }

    // If the tooltip is custom and absolutely positioned/floated, the container will not adopt those dimensions.
    // So we use the first child of the container (the tooltip itself) and fall back to the container if something goes wrong.
    const tangibleTooltip = tooltipContainer.firstElementChild as HTMLElement || tooltipContainer;
    const newTargetPosition: Coords = getTargetPosition(root, target);
    const tooltipPosition: Coords = getTooltipPosition({
      target,
      tooltip: tangibleTooltip,
      padding: maskPadding,
      tooltipSeparation,
      orientationPreferences,
      tourRoot: root,
      positionCandidateReducer
    });

    setTarget(target);
    setTooltipPosition(tooltipPosition);
    targetPosition.current = newTargetPosition;

    if (!disableAutoScroll && (!isElementInView(root, target) || !isElementInView(root, tangibleTooltip, tooltipPosition))) {
      scrollToElement(root, target);
    }

    tooltipContainer.focus();
  }

  const goToStep = (stepIndex: number) => {
    if (stepIndex >= steps.length || stepIndex < 0) {
      return;
    }
    setCurrentStepIndex(stepIndex);
  }

  const next = () => {
    goToStep(currentStepIndex + 1);
  }

  const prev = () => {
    goToStep(currentStepIndex - 1);
  }

  const close = () => {
    goToStep(0);
    setVisible(false);
  }

  const baseLogic: WalktourLogic = {
    next: next,
    prev: prev,
    close: close,
    goToStep: goToStep,
    stepContent: currentStepContent,
    stepIndex: currentStepIndex,
    allSteps: steps
  };

  const tourLogic: WalktourLogic = {
    ...baseLogic,
    ...customNextFunc && { next: () => customNextFunc(baseLogic) },
    ...customPrevFunc && { prev: () => customPrevFunc(baseLogic) }
  };

  const keyPressHandler = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        if (!disableClose) {
          close();
        }
        break;
      case "ArrowRight":
        event.preventDefault();
        if (!disableNext) {
          if (customNextFunc) {
            customNextFunc(baseLogic);
          } else {
            next();
          }
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (!disablePrev) {
          if (customPrevFunc) {
            customPrevFunc(baseLogic);
          } else {
            prev();
          }
        }
        break;
    }
  }

  //don't render if the tour is hidden or if there's no step data
  if (!isVisible || !currentStepContent) {
    return null
  };

  const portalStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: zIndex,
    visibility: tooltipPosition ? 'visible' : 'hidden'
  }

  const tooltipContainerStyle: React.CSSProperties = {
    position: 'absolute',
    top: tooltipPosition && tooltipPosition.y,
    left: tooltipPosition && tooltipPosition.x,
    transition: transition,
    width: tooltipWidth
  }

  // render mask, tooltip, and their shared "portal" container
  const render = () => (
    <div
      id={getIdString(basePortalString, identifier)}
      style={portalStyle}
    >
      <Mask
        target={target}
        disableMaskInteraction={disableMaskInteraction}
        disableCloseOnClick={disableCloseOnClick}
        padding={maskPadding}
        tourRoot={tourRoot.current}
        close={tourLogic.close}
      />

      <div
        id={getIdString(baseTooltipContainerString, identifier)}
        style={tooltipContainerStyle}
        onKeyDown={keyPressHandler}
        tabIndex={0}>
        {customTooltipRenderer
          ? customTooltipRenderer(tourLogic)
          : <Tooltip
            {...tourLogic}
          />
        }
      </div>
    </div>);

  // on first render, put everything in it's normal context.
  // after first render (once we've determined the tour root) spawn a portal there for rendering.
  if (tourRoot.current) {
    return ReactDOM.createPortal(render(), tourRoot.current);
  } else {
    return render();
  }
}

function getIdString(base: string, identifier?: string): string {
  return `${base}${identifier ? `-${identifier}` : ``}`
}

function shouldUpdate(tourRoot: Element, target: HTMLElement, targetPosition: Coords, rerenderTolerance: number): boolean {
  if (!tourRoot || !target || !targetPosition) {
    return false;
  }

  const currentTargetPosition: Coords = getTargetPosition(tourRoot, target);
  return dist(currentTargetPosition, targetPosition) > rerenderTolerance;
}