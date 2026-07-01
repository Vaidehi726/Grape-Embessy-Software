import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChefHat, LayoutDashboard, Users, Utensils, ArrowRight, CheckCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const Index = () => {
  const { user, loading } = useAuth();

  const features = [
    {
      icon: <LayoutDashboard className="h-6 w-6" />,
      title: "Multi-Restaurant Management",
      description: "Manage multiple restaurants from a single dashboard with ease.",
    },
    {
      icon: <ChefHat className="h-6 w-6" />,
      title: "Kitchen Display System",
      description: "Real-time order updates for your kitchen staff.",
    },
    {
      icon: <Utensils className="h-6 w-6" />,
      title: "Menu Management",
      description: "Create categories, add items with veg/non-veg indicators and spice levels.",
    },
    {
      icon: <Users className="h-6 w-6" />,
      title: "Table Management",
      description: "Organize tables by floors and track occupancy in real-time.",
    },
  ];

  const benefits = [
    "Easy order management from table to kitchen",
    "Real-time status updates",
    "GST-ready billing system",
    "Works on web and mobile",
    "Multi-floor table organization",
    "Customizable menu categories",
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <ChefHat className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">RestroFlow</span>
          </div>
          <div className="flex items-center gap-4">
            {loading ? null : user ? (
              <Button asChild variant="gradient">
                <Link to="/dashboard">
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link to="/auth">Sign In</Link>
                </Button>
                <Button asChild variant="gradient">
                  <Link to="/auth">Get Started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
              Streamline Your Restaurant Operations with{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                RestroFlow
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Complete restaurant management platform designed for Indian restaurants. 
              From table orders to kitchen display, manage everything in one place.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" variant="gradient" className="text-lg px-8">
                <Link to="/auth">
                  Start Free Trial
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="text-lg px-8">
                <Link to="/auth">Watch Demo</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Everything You Need to Run Your Restaurant
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Powerful features designed specifically for Indian restaurant operations.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <div
                key={index}
                className="bg-card border border-border rounded-2xl p-6 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
              >
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                Built for Indian Restaurants
              </h2>
              <p className="text-muted-foreground text-lg mb-8">
                RestroFlow understands the unique needs of Indian restaurants. 
                From veg/non-veg indicators to spice level management, 
                we've got you covered.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {benefits.map((benefit, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                    <span className="text-foreground">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="aspect-square bg-gradient-to-br from-primary/20 to-accent/20 rounded-3xl flex items-center justify-center">
                <div className="text-center p-8">
                  <ChefHat className="h-24 w-24 text-primary mx-auto mb-4" />
                  <p className="text-2xl font-bold text-foreground">RestroFlow</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">- by NIKOLAINDUSTRY</p>
                  <p className="text-muted-foreground">Restaurant Management Made Simple</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-primary to-accent">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
            Ready to Transform Your Restaurant?
          </h2>
          <p className="text-primary-foreground/80 text-lg mb-8 max-w-2xl mx-auto">
            Join hundreds of restaurant owners who trust RestroFlow for their daily operations.
          </p>
          <Button asChild size="lg" variant="secondary" className="text-lg px-8">
            <Link to="/auth">
              Get Started for Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>© 2024 RestroFlow. Built for Indian Restaurants.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
