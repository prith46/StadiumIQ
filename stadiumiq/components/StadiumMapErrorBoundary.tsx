"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  reload?: () => void;
}

interface State {
  hasError: boolean;
}

export class StadiumMapErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[StadiumMapErrorBoundary] caught exception:", error, errorInfo);
  }

  private handleRetry = () => {
    if (this.props.reload) {
      this.props.reload();
    } else {
      window.location.reload();
    }
    this.setState({ hasError: false });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center p-8 w-full min-h-[300px]">
          <Card className="max-w-md w-full border border-red-200 shadow-md text-center bg-white">
            <CardHeader className="bg-red-50 text-red-700 pb-2 rounded-t-lg">
              <CardTitle className="text-lg font-bold">Map data unavailable</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 text-gray-600 text-sm">
              An unexpected error occurred while rendering the interactive stadium map.
            </CardContent>
            <CardFooter className="flex justify-center pb-4">
              <Button
                onClick={this.handleRetry}
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
              >
                Retry
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
