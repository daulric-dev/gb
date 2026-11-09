import * as React from "react"
import { useSignal } from "@preact/signals-react"
import { useSignals } from "@preact/signals-react/runtime"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  useSignals()
  const isMobile = useSignal(
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      isMobile.value = window.innerWidth < MOBILE_BREAKPOINT
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [isMobile])

  return isMobile.value
}
