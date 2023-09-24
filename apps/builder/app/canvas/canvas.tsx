import { useMemo, useEffect } from "react";
import { useStore } from "@nanostores/react";
import { computed } from "nanostores";
import { Scripts, ScrollRestoration } from "@remix-run/react";
import type { DataSource, Instances, Page } from "@webstudio-is/project-build";
import {
  type Params,
  type Components,
  createElementsTree,
  executeEffectfulExpression,
  encodeVariablesMap,
  decodeVariablesMap,
  getIndexesWithinAncestors,
} from "@webstudio-is/react-sdk";
import * as baseComponents from "@webstudio-is/sdk-components-react";
import * as baseComponentMetas from "@webstudio-is/sdk-components-react/metas";
import * as baseComponentPropsMetas from "@webstudio-is/sdk-components-react/props";
import * as remixComponents from "@webstudio-is/sdk-components-react-remix";
import * as remixComponentMetas from "@webstudio-is/sdk-components-react-remix/metas";
import * as remixComponentPropsMetas from "@webstudio-is/sdk-components-react-remix/props";
import * as radixComponents from "@webstudio-is/sdk-components-react-radix";
import * as radixComponentMetas from "@webstudio-is/sdk-components-react-radix/metas";
import * as radixComponentPropsMetas from "@webstudio-is/sdk-components-react-radix/props";
import { hooks as radixComponentHooks } from "@webstudio-is/sdk-components-react-radix/hooks";
import { publish } from "~/shared/pubsub";
import {
  handshakenStore,
  registerContainers,
  useCanvasStore,
} from "~/shared/sync";
import { useSharedShortcuts } from "~/shared/shortcuts";
import { useCanvasShortcuts } from "./canvas-shortcuts";
import { useManageDesignModeStyles, GlobalStyles } from "./shared/styles";
import {
  WebstudioComponentCanvas,
  WebstudioComponentPreview,
} from "./features/webstudio-component";
import {
  propsIndexStore,
  assetsStore,
  pagesStore,
  instancesStore,
  useIsPreviewMode,
  selectedPageStore,
  registerComponentLibrary,
  dataSourceValuesStore,
  dataSourceVariablesStore,
  registeredComponentsStore,
  registeredComponentMetasStore,
  subscribeComponentHooks,
} from "~/shared/nano-states";
import { useDragAndDrop } from "./shared/use-drag-drop";
import { useCopyPaste } from "~/shared/copy-paste";
import { setDataCollapsed, subscribeCollapsedToPubSub } from "./collapsed";
import { useWindowResizeDebounced } from "~/shared/dom-hooks";
import { subscribeInstanceSelection } from "./instance-selection";
import { subscribeInstanceHovering } from "./instance-hovering";
import { useHashLinkSync } from "~/shared/pages";
import { useMount } from "~/shared/hook-utils/use-mount";
import { useSelectedInstance } from "./instance-selected-react";
import { subscribeInterceptedEvents } from "./interceptor";

registerContainers();

const propsByInstanceIdStore = computed(
  propsIndexStore,
  (propsIndex) => propsIndex.propsByInstanceId
);

const executeEffectfulExpressionWithDecodedVariables: typeof executeEffectfulExpression =
  (code, args, values) => {
    return decodeVariablesMap(
      executeEffectfulExpression(code, args, encodeVariablesMap(values))
    );
  };

const onDataSourceUpdate = (newValues: Map<DataSource["id"], unknown>) => {
  const dataSourceVariables = new Map(dataSourceVariablesStore.get());
  for (const [dataSourceId, value] of newValues) {
    dataSourceVariables.set(dataSourceId, value);
  }
  dataSourceVariablesStore.set(dataSourceVariables);
};

const useElementsTree = (
  components: Components,
  instances: Instances,
  params: Params
) => {
  const metas = useStore(registeredComponentMetasStore);
  const page = useStore(selectedPageStore);
  const [isPreviewMode] = useIsPreviewMode();
  const rootInstanceId = page?.rootInstanceId ?? "";

  if (typeof window === "undefined") {
    // @todo remove after https://github.com/webstudio-is/webstudio/issues/1313 now its needed to be sure that no leaks exists
    // eslint-disable-next-line no-console
    console.log({
      assetsStore: assetsStore.get().size,
      pagesStore: pagesStore.get()?.pages.length ?? 0,
      instancesStore: instancesStore.get().size,
    });
  }

  const pagesMapStore = useMemo(
    () =>
      computed(pagesStore, (pages): Map<string, Page> => {
        if (pages === undefined) {
          return new Map();
        }
        return new Map(
          [pages.homePage, ...pages.pages].map((page) => [page.id, page])
        );
      }),
    []
  );

  const indexesWithinAncestors = useMemo(() => {
    return getIndexesWithinAncestors(
      metas,
      instances,
      page ? [page.rootInstanceId] : []
    );
  }, [metas, instances, page]);

  return useMemo(() => {
    return createElementsTree({
      renderer: isPreviewMode ? "preview" : "canvas",
      imageBaseUrl: params.imageBaseUrl,
      assetBaseUrl: params.assetBaseUrl,
      instances,
      rootInstanceId,
      indexesWithinAncestors,
      propsByInstanceIdStore,
      assetsStore,
      pagesStore: pagesMapStore,
      dataSourceValuesStore,
      executeEffectfulExpression:
        executeEffectfulExpressionWithDecodedVariables,
      onDataSourceUpdate,
      Component: isPreviewMode
        ? WebstudioComponentPreview
        : WebstudioComponentCanvas,
      components,
      scripts: (
        <>
          <ScrollRestoration />
          <Scripts />
        </>
      ),
    });
  }, [
    params,
    instances,
    rootInstanceId,
    components,
    pagesMapStore,
    isPreviewMode,
    indexesWithinAncestors,
  ]);
};

const DesignMode = ({ params }: { params: Params }) => {
  useManageDesignModeStyles(params);
  useDragAndDrop();
  // We need to initialize this in both canvas and builder,
  // because the events will fire in either one, depending on where the focus is
  // @todo we need to forward the events from canvas to builder and avoid importing this
  // in both places
  useCopyPaste();

  useSelectedInstance();
  useEffect(subscribeInstanceSelection, []);
  useEffect(subscribeInstanceHovering, []);

  return null;
};

type CanvasProps = {
  params: Params;
};

export const Canvas = ({ params }: CanvasProps): JSX.Element | null => {
  const handshaken = useStore(handshakenStore);
  useCanvasStore(publish);
  const [isPreviewMode] = useIsPreviewMode();

  useMount(() => {
    registerComponentLibrary({
      components: baseComponents,
      metas: baseComponentMetas,
      propsMetas: baseComponentPropsMetas,
    });
    registerComponentLibrary({
      components: remixComponents,
      metas: remixComponentMetas,
      propsMetas: remixComponentPropsMetas,
    });
    registerComponentLibrary({
      namespace: "@webstudio-is/sdk-components-react-radix",
      components: radixComponents,
      metas: radixComponentMetas,
      propsMetas: radixComponentPropsMetas,
      hooks: radixComponentHooks,
    });
  });

  useEffect(subscribeComponentHooks, []);

  // e.g. toggling preview is still needed in both modes
  useCanvasShortcuts();
  useSharedShortcuts({ source: "canvas" });
  const selectedPage = useStore(selectedPageStore);

  useEffect(() => {
    const rootInstanceId = selectedPage?.rootInstanceId;
    if (rootInstanceId !== undefined) {
      setDataCollapsed(rootInstanceId);
    }
  });

  useWindowResizeDebounced(() => {
    const rootInstanceId = selectedPage?.rootInstanceId;
    if (rootInstanceId !== undefined) {
      setDataCollapsed(rootInstanceId);
    }
  });

  useEffect(subscribeCollapsedToPubSub, []);

  useHashLinkSync();

  useEffect(subscribeInterceptedEvents, []);

  const components = useStore(registeredComponentsStore);
  const instances = useStore(instancesStore);
  const elements = useElementsTree(components, instances, params);

  console.log("Canvas", { elements });

  if (components.size === 0 || instances.size === 0) {
    return (
      <body>
        <ScrollRestoration />
        <Scripts />
      </body>
    );
  }

  return (
    <>
      <GlobalStyles params={params} />
      {elements}
      {
        // Call hooks after render to ensure effects are last.
        // Helps improve outline calculations as all styles are then applied.
      }
      {isPreviewMode === false && handshaken === true && (
        <DesignMode params={params} />
      )}
    </>
  );
};
